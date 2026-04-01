import { NextRequest, NextResponse } from 'next/server'
import { SupabaseClient, createClient } from '@supabase/supabase-js'

interface KnowledgeItem {
  id: string
  content: string
  source_name: string
  created_at: string
  embedding?: number[]
}

interface RawKnowledgeItem {
  id: string
  content: string
  created_at: string
  openai_embedding: string | number[] | null
  document_id: string | null
}

interface ConflictGroup {
  id: string
  topic: string
  conflicts: Array<{
    id: string
    content: string
    source_name: string
    created_at: string
    confidence: number
    conflictType: 'semantic' | 'factual' | 'logical'
    extractedValue?: string
  }>
  similarity: number
}

interface AnalysisResult {
  conflicts: ConflictGroup[]
  totalAnalyzed: number
  totalConflicts: number
  qualityScore: number
}

interface BatchJob {
  id: string
  knowledge_base_id: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  progress: number
  total_items: number
  processed_items: number
  conflicts_found: ConflictGroup[]
  started_at: string
  completed_at?: string
  error_message?: string
}

const BATCH_SIZE = 50 // Process 50 items at a time
const MAX_PROCESSING_TIME = 50000 // 50 seconds, leaving 10s buffer

const SIMILARITY_THRESHOLD = 0.72 // Minimum cosine similarity to treat a pair as conflict candidate
const MAX_GROUP_SIZE = 25          // Maximum items per focused GPT analysis call
const GPT_MAX_TOKENS = 4000        // Token budget for GPT conflict-analysis response

export async function POST(request: NextRequest) {
  const startTime = Date.now()
  
  try {
    // Create Supabase client
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    
    // Parse request body
    const body = await request.json()
    const { knowledgeBaseId, batchId, continueProcessing } = body
    
    console.log('🔐 Using service role key for authentication')
    console.log('📋 Knowledge Base ID:', knowledgeBaseId)
    console.log('🔄 Batch ID:', batchId)
    console.log('⏱️  Continue Processing:', continueProcessing)
    
    // If continuing an existing batch job
    if (continueProcessing && batchId) {
      return await continueBatchProcessing(supabase, batchId, startTime)
    }
    
    // Check if there's already a running job for this knowledge base
    const { data: existingJob, error: jobError } = await supabase
      .from('mismatch_analysis_jobs')
      .select('*')
      .eq('knowledge_base_id', knowledgeBaseId)
      .eq('status', 'processing')
      .single()
    
    if (existingJob && !jobError) {
      // Return existing job status
      return NextResponse.json({
        jobId: existingJob.id,
        status: existingJob.status,
        progress: existingJob.progress,
        isProcessing: true
      })
    }
    
    // Start new analysis
    return await startNewAnalysis(supabase, knowledgeBaseId, startTime)
    
  } catch (error) {
    console.error('Error in mismatch analysis:', error)
    return NextResponse.json({ error: 'Fehler bei der Analyse' }, { status: 500 })
  }
}

/**
 * Start a new analysis job
 */
async function startNewAnalysis(supabase: any, knowledgeBaseId: string, startTime: number) {
  console.log('🚀 Starting new mismatch analysis...')
  
  // Get all knowledge items with embeddings
  const { data: rawItems, error } = await supabase
    .from('knowledge_items')
    .select('id, content, created_at, openai_embedding, document_id')
    .eq('knowledge_base_id', knowledgeBaseId) // Filter hinzugefügt
    .not('openai_embedding', 'is', null)
    .order('created_at', { ascending: false })
  
  if (error) {
    console.error('❌ Database Error:', error)
    return NextResponse.json({ error: 'Fehler beim Laden der Daten' }, { status: 500 })
  }
  
  if (!rawItems || rawItems.length === 0) {
    return NextResponse.json({ 
      conflictGroups: [], 
      totalEntries: 0, 
      conflictsFound: 0, 
      qualityScore: 100,
      isCompleted: true
    })
  }
  
  // Convert and filter valid items
  const items: KnowledgeItem[] = (rawItems as RawKnowledgeItem[])
    .map((item: RawKnowledgeItem): KnowledgeItem | null => {
      try {
        return {
          id: item.id,
          content: item.content,
          source_name: `Document ${item.document_id || 'Unknown'}`,
          created_at: item.created_at,
          embedding: typeof item.openai_embedding === 'string' 
            ? JSON.parse(item.openai_embedding) 
            : item.openai_embedding
        }
      } catch (e) {
        console.error(`Error parsing embedding for item ${item.id}:`, e)
        return null
      }
    })
    .filter((item): item is KnowledgeItem => 
      item !== null && item.embedding != null && Array.isArray(item.embedding)
    )
  
  console.log(`📊 Found ${items.length} items with valid embeddings`)
  
  if (items.length === 0) {
    return NextResponse.json({ 
      conflictGroups: [], 
      totalEntries: 0, 
      conflictsFound: 0, 
      qualityScore: 100,
      isCompleted: true 
    })
  }
  
  // Create new batch job
  const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  
  const { error: jobCreateError } = await supabase
    .from('mismatch_analysis_jobs')
    .insert({
      id: jobId,
      knowledge_base_id: knowledgeBaseId,
      status: 'processing',
      progress: 0,
      total_items: items.length,
      processed_items: 0,
      conflicts_found: [],
      started_at: new Date().toISOString()
    })
  
  if (jobCreateError) {
    console.error('❌ Error creating job:', jobCreateError)
    return NextResponse.json({ error: 'Fehler beim Erstellen des Jobs' }, { status: 500 })
  }
  
  // Process first batch
  const result = await processBatch(supabase, jobId, items, 0, startTime)
  
  return NextResponse.json(result)
}

/**
 * Continue processing an existing batch job
 */
async function continueBatchProcessing(supabase: any, batchId: string, startTime: number) {
  console.log('🔄 Continuing batch processing for job:', batchId)
  
  // Get job details
  const { data: job, error: jobError } = await supabase
    .from('mismatch_analysis_jobs')
    .select('*')
    .eq('id', batchId)
    .single()
  
  if (jobError || !job) {
    console.error('❌ Job not found:', jobError)
    return NextResponse.json({ error: 'Job nicht gefunden' }, { status: 404 })
  }
  
  if (job.status === 'completed') {
    return NextResponse.json({
      jobId: job.id,
      status: 'completed',
      progress: 100,
      conflictGroups: job.conflicts_found || [],
      totalEntries: job.total_items,
      conflictsFound: (job.conflicts_found || []).reduce((sum: number, group: ConflictGroup) => sum + group.conflicts.length, 0),
      qualityScore: Math.round(((job.total_items - (job.conflicts_found || []).reduce((sum: number, group: ConflictGroup) => sum + group.conflicts.length, 0)) / job.total_items) * 100),
      isCompleted: true
    })
  }
  
  // Get all items again for continued processing
  const { data: rawItems, error } = await supabase
    .from('knowledge_items')
    .select('id, content, created_at, openai_embedding, document_id')
    .not('openai_embedding', 'is', null)
    .order('created_at', { ascending: false })
  
  if (error || !rawItems) {
    console.error('❌ Error loading items:', error)
    return NextResponse.json({ error: 'Fehler beim Laden der Daten' }, { status: 500 })
  }
  
  // Convert items
  const items: KnowledgeItem[] = rawItems
    .map((item: RawKnowledgeItem): KnowledgeItem | null => {
      try {
        return {
          id: item.id,
          content: item.content,
          source_name: `Document ${item.document_id || 'Unknown'}`,
          created_at: item.created_at,
          embedding: typeof item.openai_embedding === 'string' 
            ? JSON.parse(item.openai_embedding) 
            : item.openai_embedding
        }
      } catch (e) {
        return null
      }
    })
    .filter((item): item is KnowledgeItem => 
      item !== null && item.embedding != null && Array.isArray(item.embedding)
    )
  
  // Continue from where we left off
  const result = await processBatch(supabase, batchId, items, job.processed_items, startTime)
  
  return NextResponse.json(result)
}

/**
 * Process a batch of items for conflict detection
 */
async function processBatch(supabase: any, jobId: string, items: KnowledgeItem[], startIndex: number, startTime: number) {
  // With GPT-4.1's 1M token context, we can process all items at once
  console.log(`🔄 Processing all ${items.length} items at once`)
  
  const conflicts = await findConflictsInBatch(items, items) // Pass all items to both parameters
  
  const isCompleted = true // Always complete in one go
  const progress = 100
  
  await updateJobProgress(supabase, jobId, items.length, conflicts, isCompleted)
  
  return {
    jobId,
    status: isCompleted ? 'completed' : 'processing',
    progress,
    conflictGroups: conflicts,
    totalEntries: items.length,
    conflictsFound: conflicts.length,
    qualityScore: conflicts.length > 0 ? Math.max(20, 100 - conflicts.length * 5) : 100,
    isCompleted
  }
}

/**
 * Find conflicts using embedding-based pre-filtering followed by focused GPT-4.1 calls.
 *
 * Instead of one huge mega-prompt (which suffers from "lost-in-the-middle" attention
 * degradation and a too-small max_tokens budget), we:
 *   1. Compute cosine similarity for every pair of items.
 *   2. Collect pairs above SIMILARITY_THRESHOLD into a candidate set.
 *   3. Group candidates into connected components (BFS) so each GPT call sees
 *      only items that are actually related to each other.
 *   4. Send each group to GPT-4.1 for precise conflict detection.
 */
async function findConflictsInBatch(batch: KnowledgeItem[], allItems: KnowledgeItem[]): Promise<ConflictGroup[]> {
  if (allItems.length < 2) {
    console.log('Not enough items to analyze')
    return []
  }

  console.log(`🧠 Embedding-based pre-filter: computing similarities for ${allItems.length} items...`)

  // ── Step 1: Find candidate pairs via cosine similarity ──────────────────────
  const candidatePairs: Array<{ idx1: number; idx2: number }> = []

  for (let i = 0; i < allItems.length; i++) {
    for (let j = i + 1; j < allItems.length; j++) {
      const embA = allItems[i].embedding
      const embB = allItems[j].embedding
      if (!embA || !embB) continue

      const sim = cosineSimilarity(embA, embB)
      if (sim >= SIMILARITY_THRESHOLD) {
        candidatePairs.push({ idx1: i, idx2: j })
      }
    }
  }

  console.log(`📊 ${candidatePairs.length} candidate pair(s) above threshold ${SIMILARITY_THRESHOLD}`)

  if (candidatePairs.length === 0) {
    console.log('✅ No similar pairs found – knowledge base appears consistent based on embeddings.')
    return []
  }

  // ── Step 2: Group candidates into connected components (BFS) ────────────────
  const adjacency = new Map<number, Set<number>>()
  for (const { idx1, idx2 } of candidatePairs) {
    if (!adjacency.has(idx1)) adjacency.set(idx1, new Set())
    if (!adjacency.has(idx2)) adjacency.set(idx2, new Set())
    adjacency.get(idx1)!.add(idx2)
    adjacency.get(idx2)!.add(idx1)
  }

  const visited = new Set<number>()
  const groups: number[][] = []

  for (const startIdx of adjacency.keys()) {
    if (visited.has(startIdx)) continue
    const group: number[] = []
    const queue = [startIdx]
    while (queue.length > 0) {
      const idx = queue.shift()!
      if (visited.has(idx)) continue
      visited.add(idx)
      group.push(idx)
      for (const neighbor of adjacency.get(idx) ?? []) {
        if (!visited.has(neighbor)) queue.push(neighbor)
      }
    }
    if (group.length >= 2) groups.push(group)
  }

  console.log(`🔗 Formed ${groups.length} candidate group(s) for focused GPT-4.1 analysis`)

  // ── Step 3: Analyze each group with GPT-4.1 ─────────────────────────────────
  const allConflicts: ConflictGroup[] = []

  for (const group of groups) {
    // Cap group size to avoid context blow-up while still being comprehensive
    const cappedIndices = group.slice(0, MAX_GROUP_SIZE)
    const groupItems = cappedIndices.map(idx => allItems[idx])
    const groupConflicts = await analyzeGroupWithGPT(groupItems)
    allConflicts.push(...groupConflicts)
  }

  const merged = mergeConflictGroups(allConflicts)
  console.log(`✅ Found ${merged.length} unique conflict group(s) after merging`)
  return merged
}

/**
 * Send a focused group of semantically related items to GPT-4.1 for conflict detection.
 * Because the group is already pre-filtered by embedding similarity, the prompt is small
 * and GPT's attention is fully focused — much more accurate than a single mega-prompt.
 */
async function analyzeGroupWithGPT(items: KnowledgeItem[]): Promise<ConflictGroup[]> {
  const conflicts: ConflictGroup[] = []
  if (items.length < 2) return conflicts

  const factsText = items.map((item, index) => `[${index + 1}] ${item.content}`).join('\n\n')
  console.log(`🤖 Sending ${items.length} items to GPT-4.1 for conflict analysis`)

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4.1-2025-04-14',
        messages: [
          {
            role: 'system',
            content: `You are an expert conflict detector for a vector-based AI knowledge retrieval system.

SYSTEM ARCHITECTURE (critical for your decisions):
This knowledge base powers AI agents that answer customer queries. The retrieval flow is:
1. The agent generates 5 search questions about a customer issue
2. Each question is embedded into a 1536-dimensional vector
3. These vectors are compared via cosine similarity against stored knowledge_item embeddings
4. The top 5-6 closest items are injected into the agent's context window
5. The agent answers the customer based solely on these retrieved facts

WHY THIS MATTERS FOR CONFLICTS:
Because retrieval is purely similarity-based, items about the same narrow topic will BOTH appear in the agent's context simultaneously. A true conflict means the agent receives two contradictory facts at once and cannot give a correct answer. These are the most dangerous failures in this system.

The items you are analyzing have ALREADY been pre-filtered by embedding cosine similarity (threshold ≥ 0.72), meaning they are semantically close enough that the retrieval system will frequently return them together. This makes any VALUE contradictions between them especially harmful.

TASK: Find ONLY real contradictions – two facts that claim different truths about exactly the SAME subject and attribute.

Think step by step:
1. For every fact extract:
   • SUBJECT – the specific entity the fact is about (person, product, rule, service)
   • ATTRIBUTE – the specific property being stated (price, duration, availability, etc.)
   • CONTEXT – any qualifying condition (e.g., "for standard shipping", "without receipt")
   • VALUE – the concrete claim, number, or boolean

2. Group facts that share the SAME SUBJECT + ATTRIBUTE + CONTEXT (case-insensitive, synonyms allowed).

3. Inside each group compare the VALUEs:
   • TRUE CONFLICT: different values for the same measurement (€, days, %, quantity)
   • TRUE CONFLICT: logical opposites ("ja" vs "nein", "kostenlos" vs "kostenpflichtig", "möglich" vs "nicht möglich")
   • TRUE CONFLICT: mutually exclusive claims ("Pizza" vs "Burger" for the same preference)
   • NOT a conflict: small rounding differences (±1 unit) unless context makes precision critical

4. DO NOT flag:
   • Different qualifying contexts or conditions ("online" vs "im Laden", "mit Quittung" vs "ohne Quittung")
   • General rules vs specific exceptions (these can coexist)
   • Complementary facts about different attributes of the same subject
   • Different subjects (even if similar names — "Produkt A" vs "Produkt B")

Examples of REAL CONFLICTS (agent would be confused):
- "Rückgabefrist: 14 Tage" vs "Rückgabefrist: 30 Tage" (same rule, different values → agent gives wrong answer)
- "Versand kostenlos" vs "Versandkosten: 4,99€" (same context, opposite claims)
- "Ellen mag Pizza" vs "Ellen mag Burger" (same attribute, different values)

Examples of NOT CONFLICTS:
- "Standardversand: 3-5 Tage" vs "Expressversand: 1-2 Tage" (different contexts)
- "Preis online: 10€" vs "Preis im Laden: 15€" (different channels = different contexts)
- "Rückgabe möglich" vs "Erstattung dauert 5-7 Tage" (different attributes)

Output format (exactly):
CONFLICT: [number1] vs [number2] - Short concise reason in German
(one conflict per line)
If no conflicts found, output exactly:
NO CONFLICTS FOUND`
          },
          {
            role: 'user',
            content: `Analyze these ${items.length} facts and find ONLY true contradictions:\n\n${factsText}`
          }
        ],
        max_tokens: GPT_MAX_TOKENS,
        temperature: 0.1
      })
    })

    if (!response.ok) {
      const errorData = await response.json()
      console.error('❌ GPT-4.1 API error:', errorData)
      return conflicts
    }

    const data = await response.json()
    const aiResponse = data.choices[0].message.content
    console.log(`   Response (${aiResponse.length} chars): ${aiResponse.substring(0, 200)}`)

    const conflictMatches = aiResponse.matchAll(/CONFLICT:\s*\[(\d+)\]\s*vs\s*\[(\d+)\]\s*-\s*(.+)/g)
    const processedPairs = new Set<string>()
    let conflictCount = 0

    for (const match of conflictMatches) {
      const idx1 = parseInt(match[1]) - 1
      const idx2 = parseInt(match[2]) - 1
      const reason = match[3].trim()
      const pairKey = [idx1, idx2].sort().join('-')

      if (processedPairs.has(pairKey)) continue
      if (idx1 < 0 || idx1 >= items.length || idx2 < 0 || idx2 >= items.length) continue

      processedPairs.add(pairKey)
      conflicts.push({
        id: `conflict_${Date.now()}_${conflictCount++}`,
        topic: reason,
        conflicts: [
          {
            id: items[idx1].id,
            content: items[idx1].content,
            source_name: items[idx1].source_name,
            created_at: items[idx1].created_at,
            confidence: 95,
            conflictType: 'factual' as const,
            extractedValue: extractKeyValue(items[idx1].content)
          },
          {
            id: items[idx2].id,
            content: items[idx2].content,
            source_name: items[idx2].source_name,
            created_at: items[idx2].created_at,
            confidence: 95,
            conflictType: 'factual' as const,
            extractedValue: extractKeyValue(items[idx2].content)
          }
        ],
        similarity: 80
      })
    }

    console.log(`   Found ${conflicts.length} conflict(s) in this group`)
  } catch (error) {
    console.error('❌ Error in GPT-4.1 group analysis:', error)
  }

  return conflicts
}

/**
 * Group items by their main topic/theme (dynamic topic extraction)
 */
function groupItemsByTopic(items: KnowledgeItem[], processed: Set<string>): Map<string, KnowledgeItem[]> {
  const topicGroups = new Map<string, KnowledgeItem[]>()
  
  // Dynamic topic grouping based on common keywords and similarity
  for (const item of items) {
    if (processed.has(item.id)) continue
    
    // Extract key subjects and entities from this item
    const entities = extractEntities(item.content)
    const mainSubject = extractMainSubject(item.content)
    
    // Try to find an existing group with similar content
    let addedToGroup = false
    
    for (const [topicName, groupItems] of topicGroups) {
      // Check if this item shares subjects/entities with existing group
      const groupEntities = groupItems.flatMap(groupItem => extractEntities(groupItem.content))
      const sharedEntities = entities.filter(e => groupEntities.includes(e))
      
      if (sharedEntities.length > 0 || groupItems.some(groupItem => 
        extractMainSubject(groupItem.content) === mainSubject && mainSubject !== ''
      )) {
        groupItems.push(item)
        addedToGroup = true
        break
      }
    }
    
    // If no matching group found, create a new one
    if (!addedToGroup) {
      const topicName = mainSubject || entities[0] || 'Allgemeine Informationen'
      if (!topicGroups.has(topicName)) {
        topicGroups.set(topicName, [])
      }
      topicGroups.get(topicName)!.push(item)
    }
  }
  
  return topicGroups
}

/**
 * Extract main subject from text (person, product, concept)
 */
function extractMainSubject(text: string): string {
  const lowerText = text.toLowerCase()
  
  // Look for person names (starting with capital letter)
  const nameMatch = text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/)
  if (nameMatch && nameMatch[1].length > 1) {
    return nameMatch[1]
  }
  
  // Look for product or concept mentions
  const conceptMatch = lowerText.match(/\b(der|die|das)\s+([a-zäöüß]+(?:\s+[a-zäöüß]+)?)\b/)
  if (conceptMatch && conceptMatch[2]) {
    return conceptMatch[2]
  }
  
  // Look for other subjects
  const subjectMatch = lowerText.match(/^([a-zäöüß]+(?:\s+[a-zäöüß]+)?)/i)
  if (subjectMatch && subjectMatch[1] && subjectMatch[1].length > 2) {
    return subjectMatch[1]
  }
  
  return ''
}

/**
 * Analyze an entire topic group for conflicts with a single AI call
 */
async function analyzeTopicGroupForConflicts(topic: string, items: KnowledgeItem[]): Promise<ConflictGroup[]> {
  const conflicts: ConflictGroup[] = []
  
  // Don't process groups that are too large
  if (items.length > 20) {
    console.log(`   ⚠️  Group too large (${items.length} items), taking first 20`)
    items = items.slice(0, 20)
  }
  
  try {
    // Prepare the facts for AI analysis
    const factsText = items.map((item, index) => 
      `[${index + 1}] ${item.content}`
    ).join('\n\n')
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a conflict detector analyzing facts about "${topic}".

Your task: Find ONLY real contradictions between the numbered facts.

A CONFLICT exists when:
- Two facts give different values for the SAME property of the SAME subject (e.g., "Ellen likes Pizza" vs "Ellen likes Burger")
- Two facts give different numbers for the SAME measurement (e.g., "14 days" vs "30 days" for same rule)
- One fact says something is true, another says it's false about the SAME thing
- Facts contain opposite information about the SAME specific subject and attribute

NOT conflicts:
- Different subjects (Ellen vs Peter)
- Different aspects or properties of the same subject
- Complementary information
- General vs specific information with different contexts

Output format:
For each conflict found, write EXACTLY:
CONFLICT: [number1] vs [number2] - Brief reason

If no conflicts exist, write:
NO CONFLICTS FOUND`
          },
          {
            role: 'user',
            content: `Analyze these facts about ${topic} and identify any conflicts:\n\n${factsText}`
          }
        ],
        max_tokens: 500,
        temperature: 0.1
      })
    })
    
    if (!response.ok) {
      console.error('   ❌ AI API error')
      return conflicts
    }
    
    const data = await response.json()
    const aiResponse = data.choices[0].message.content
    console.log(`   🤖 AI Response:\n${aiResponse}`)
    
    // Parse AI response for conflicts
    const conflictMatches = aiResponse.matchAll(/CONFLICT:\s*\[(\d+)\]\s*vs\s*\[(\d+)\]\s*-\s*(.+)/g)
    
    for (const match of conflictMatches) {
      const idx1 = parseInt(match[1]) - 1
      const idx2 = parseInt(match[2]) - 1
      const reason = match[3].trim()
      
      if (idx1 >= 0 && idx1 < items.length && idx2 >= 0 && idx2 < items.length) {
        const conflictGroup: ConflictGroup = {
          id: `conflict_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          topic: `${topic}: ${reason}`,
          conflicts: [
            {
              id: items[idx1].id,
              content: items[idx1].content,
              source_name: items[idx1].source_name,
              created_at: items[idx1].created_at,
              confidence: 90,
              conflictType: 'factual' as const,
              extractedValue: extractKeyValue(items[idx1].content)
            },
            {
              id: items[idx2].id,
              content: items[idx2].content,
              source_name: items[idx2].source_name,
              created_at: items[idx2].created_at,
              confidence: 90,
              conflictType: 'factual' as const,
              extractedValue: extractKeyValue(items[idx2].content)
            }
          ],
          similarity: 75 // Default similarity for AI-detected conflicts
        }
        
        conflicts.push(conflictGroup)
      }
    }
    
  } catch (error) {
    console.error(`   ❌ Error analyzing topic group:`, error)
  }
  
  return conflicts
}

/**
 * Find potential conflict pairs based on shared topics and keywords
 */
function findPotentialConflictPairs(batch: KnowledgeItem[], allItems: KnowledgeItem[], processed: Set<string>): Array<{item1: KnowledgeItem, item2: KnowledgeItem, similarity: number}> {
  const pairs: Array<{item1: KnowledgeItem, item2: KnowledgeItem, similarity: number}> = []
  
  for (const item of batch) {
    if (processed.has(item.id)) continue
    
    // Extract key entities from the item
    const entities1 = extractEntities(item.content)
    
    for (const other of allItems) {
      if (other.id === item.id || processed.has(other.id)) continue
      
      const entities2 = extractEntities(other.content)
      
      // Check if they talk about the same thing
      const sharedEntities = entities1.filter(e => entities2.includes(e))
      
      if (sharedEntities.length > 0 && item.embedding && other.embedding) {
        const similarity = cosineSimilarity(item.embedding, other.embedding)
        
        // Only consider pairs that talk about the same thing but say different things
        if (similarity > 0.4 && similarity < 0.85) {
          pairs.push({ item1: item, item2: other, similarity: similarity * 100 })
          console.log(`📌 Found potential conflict pair about "${sharedEntities.join(', ')}" (${(similarity * 100).toFixed(1)}% similar)`)
        }
      }
    }
  }
  
  return pairs
}

/**
 * Merge conflict groups that describe the same topic to avoid duplicates in the UI
 */
function mergeConflictGroups(groups: ConflictGroup[]): ConflictGroup[] {
  const merged = new Map<string, ConflictGroup>()

  for (const group of groups) {
    const normalizedTopic = normalizeTopic(group.topic)

    if (!merged.has(normalizedTopic)) {
      merged.set(normalizedTopic, {
        ...group,
        conflicts: dedupeConflicts(group.conflicts)
      })
      continue
    }

    const existing = merged.get(normalizedTopic)!
    const combinedConflicts = dedupeConflicts([...existing.conflicts, ...group.conflicts])

    merged.set(normalizedTopic, {
      ...existing,
      topic: chooseMoreInformativeTopic(existing.topic, group.topic),
      conflicts: combinedConflicts,
      similarity: Math.max(existing.similarity, group.similarity)
    })
  }

  return Array.from(merged.values()).sort((a, b) => b.conflicts.length - a.conflicts.length)
}

function dedupeConflicts(conflicts: ConflictGroup['conflicts']): ConflictGroup['conflicts'] {
  const unique = new Map<string, ConflictGroup['conflicts'][number]>()
  for (const conflict of conflicts) {
    if (!unique.has(conflict.id)) {
      unique.set(conflict.id, conflict)
    }
  }
  return Array.from(unique.values())
}

function normalizeTopic(topic: string): string {
  return topic
    .toLowerCase()
    .replace(/[\s]+/g, ' ')
    .replace(/[^\wäöüß0-9 ]+/g, '')
    .trim()
}

function chooseMoreInformativeTopic(topicA: string, topicB: string): string {
  if (!topicA) return topicB
  if (!topicB) return topicA

  // Prefer the longer topic assuming it contains more context
  return topicB.length > topicA.length ? topicB : topicA
}

/**
 * Extract key entities (names, concepts, numbers) from text universally
 */
function extractEntities(text: string): string[] {
  const entities: string[] = []
  const lowerText = text.toLowerCase()
  
  // Extract proper nouns (names, brands, places) - capitalized words
  const properNouns = text.match(/\b[A-Z][a-zäöüß]+\b/g)
  if (properNouns) {
    entities.push(...properNouns.map(noun => noun.toLowerCase()))
  }
  
  // Extract quoted strings or emphasized terms
  const quotedTerms = text.match(/"([^"]+)"/g)
  if (quotedTerms) {
    entities.push(...quotedTerms.map(term => term.replace(/"/g, '').toLowerCase()))
  }
  
  // Extract important nouns (subjects of sentences)
  const importantNouns = lowerText.match(/\b[a-zäöüß]{4,}\b/g)
  if (importantNouns) {
    // Filter out common words
    const filteredNouns = importantNouns.filter(noun => 
      !['sind', 'haben', 'wird', 'werden', 'kann', 'können', 'soll', 'sollte', 'muss', 'müssen', 
        'auch', 'noch', 'aber', 'wenn', 'dann', 'durch', 'ohne', 'gegen', 'während', 'wegen',
        'this', 'that', 'have', 'will', 'should', 'could', 'would', 'with', 'from', 'they',
        'where', 'when', 'what', 'which', 'there', 'these', 'those'].includes(noun)
    )
    entities.push(...filteredNouns.slice(0, 3)) // Take max 3 important nouns
  }
  
  // Extract time periods
  const timePeriods = lowerText.match(/\d+\s*(?:tag|tage|monat|monate|jahr|jahre|stunde|stunden|woche|wochen|minute|minuten)/gi)
  if (timePeriods) entities.push(...timePeriods)
  
  // Extract monetary values (with various currencies)
  const monetaryValues = lowerText.match(/\d+(?:[,.]\d+)?\s*(?:€|euro|eur|\$|dollar|£|pound)/gi)
  if (monetaryValues) entities.push(...monetaryValues)
  
  // Extract percentages
  const percentages = lowerText.match(/\d+(?:[,.]\d+)?\s*%/gi)
  if (percentages) entities.push(...percentages)
  
  // Extract quantities with units
  const quantities = lowerText.match(/\d+\s*(?:kg|gram|liter|meter|cm|mm|stück|stk)/gi)
  if (quantities) entities.push(...quantities)
  
  return [...new Set(entities)]
}

/**
 * Analyze a specific pair for conflicts
 */
async function analyzeConflictPair(item1: KnowledgeItem, item2: KnowledgeItem): Promise<boolean> {
  const text1 = item1.content.toLowerCase()
  const text2 = item2.content.toLowerCase()
  
  console.log(`\n🔬 Analyzing potential conflict:`)
  console.log(`   1️⃣ "${item1.content.substring(0, 100)}..."`)
  console.log(`   2️⃣ "${item2.content.substring(0, 100)}..."`)
  
  // Quick pattern-based checks first
  const quickConflict = checkQuickConflicts(text1, text2)
  if (quickConflict) {
    console.log(`   ✅ Quick conflict detected: ${quickConflict}`)
    return true
  }
  
  // For more complex cases, use AI
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a conflict detector. Analyze if two statements contradict each other.

A CONFLICT exists when:
- They make opposite claims about the SAME thing (e.g., "free" vs "costs 5€")
- They give different values for the SAME property (e.g., "14 days" vs "30 days" for return period)
- One says something is possible, the other says it's not

NO CONFLICT when:
- They talk about different things
- They provide complementary information
- One is more specific than the other

Answer with YES or NO only.`
          },
          {
            role: 'user',
            content: `Statement 1: ${item1.content}\n\nStatement 2: ${item2.content}\n\nDo these statements contradict each other?`
          }
        ],
        max_tokens: 10,
        temperature: 0
      })
    })
    
    if (response.ok) {
      const data = await response.json()
      const aiResponse = data.choices[0].message.content.trim().toUpperCase()
      console.log(`   🤖 AI says: ${aiResponse}`)
      return aiResponse.startsWith('YES')
    }
  } catch (error) {
    console.log(`   ❌ AI error, falling back to pattern matching`)
  }
  
  return false
}

/**
 * Quick pattern-based conflict detection
 */
function checkQuickConflicts(text1: string, text2: string): string | null {
  // Extract numbers with their contexts
  const num1 = extractNumberWithContext(text1)
  const num2 = extractNumberWithContext(text2)
  
  if (num1 && num2 && num1.context === num2.context && num1.value !== num2.value) {
    return `Different ${num1.context}: ${num1.value} vs ${num2.value}`
  }
  
  // Check for opposite keywords about the same topic
  const opposites = [
    ['kostenlos', 'kostenpflichtig'],
    ['gratis', 'gebühr'],
    ['möglich', 'nicht möglich'],
    ['verfügbar', 'nicht verfügbar'],
    ['ja', 'nein'],
    ['immer', 'nie'],
    ['alle', 'keine'],
    ['inklusive', 'exklusive']
  ]
  
  for (const [word1, word2] of opposites) {
    if ((text1.includes(word1) && text2.includes(word2)) || 
        (text1.includes(word2) && text2.includes(word1))) {
      return `Opposite terms: ${word1} vs ${word2}`
    }
  }
  
  return null
}

/**
 * Extract number with its context (what the number refers to)
 */
function extractNumberWithContext(text: string): {value: string, context: string} | null {
  // Price context
  const priceMatch = text.match(/(\d+(?:[,.]\d+)?)\s*€/i)
  if (priceMatch) {
    return { value: priceMatch[1], context: 'price' }
  }
  
  // Time period context
  const timeMatch = text.match(/(\d+)\s*(tag|monat|jahr|stunde|woche)/i)
  if (timeMatch) {
    return { value: timeMatch[1], context: timeMatch[2].toLowerCase() }
  }
  
  // Percentage context  
  const percentMatch = text.match(/(\d+(?:[,.]\d+)?)\s*%/i)
  if (percentMatch) {
    return { value: percentMatch[1], context: 'percentage' }
  }
  
  return null
}

/**
 * Extract topic from conflict pair
 */
function extractConflictTopic(item1: KnowledgeItem, item2: KnowledgeItem): string {
  const entities1 = extractEntities(item1.content)
  const entities2 = extractEntities(item2.content)
  const shared = entities1.filter(e => entities2.includes(e))
  
  if (shared.length > 0) {
    return shared.slice(0, 3).join(', ')
  }
  
  return 'Widersprüchliche Informationen'
}

/**
 * Update job progress in database
 */
async function updateJobProgress(supabase: any, jobId: string, processedItems: number, conflicts: ConflictGroup[], isCompleted: boolean) {
  const updateData: any = {
    processed_items: processedItems,
    conflicts_found: conflicts,
    progress: Math.round((processedItems / (processedItems || 1)) * 100)
  }
  
  if (isCompleted) {
    updateData.status = 'completed'
    updateData.completed_at = new Date().toISOString()
    updateData.progress = 100
  }
  
  const { error } = await supabase
    .from('mismatch_analysis_jobs')
    .update(updateData)
    .eq('id', jobId)
  
  if (error) {
    console.error('❌ Error updating job progress:', error)
  } else {
    console.log(`✅ Updated job ${jobId}: ${processedItems} items processed`)
  }
}

/**
 * Simplified AI conflict analysis for batch processing
 */
async function analyzeGroupForConflictsSimple(items: KnowledgeItem[]): Promise<boolean> {
  try {
    // Only use AI for small groups to save time and tokens
    if (items.length > 4) {
      console.log(`   ⚠️  Group too large (${items.length} items) - using simple pattern matching`)
      return checkSimpleConflicts(items)
    }

    // Prepare content for AI analysis
    const contentToAnalyze = items.map((item, index) => 
      `${index + 1}. ${item.content}`
    ).join('\n\n')
    
    console.log(`   🤖 Sending ${items.length} items to AI for conflict analysis...`)
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
              body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `Analyze these texts for REAL contradictions. 

REAL CONFLICTS are only:
- Direct opposites (yes vs no, available vs not available, always vs never)
- Different numbers/prices for the same thing
- Contradictory facts about the same object

NOT CONFLICTS:
- Different properties of the same object
- Complementary information
- Different aspects/perspectives

Answer only with "YES" or "NO".`
          },
          {
            role: 'user',
            content: `Is there a real contradiction here?\n\n${contentToAnalyze}`
          }
        ],
        max_tokens: 50,
        temperature: 0.1
      })
    })
    
    if (!response.ok) {
      console.log(`   ❌ OpenAI API error - fallback to simple detection`)
      return checkSimpleConflicts(items)
    }
    
    const data = await response.json()
    const aiResponse = data.choices[0].message.content.trim()
    
    console.log(`   🤖 AI Response: "${aiResponse}"`)
    
    const hasConflict = aiResponse.toUpperCase().startsWith('YES')
    console.log(`   => AI Result: ${hasConflict ? 'CONFLICT' : 'NO CONFLICT'}`)
    
    return hasConflict
    
  } catch (error) {
    console.error(`   ❌ Error in AI analysis:`, error)
    return checkSimpleConflicts(items)
  }
}

/**
 * Universal conflict detection with language-agnostic patterns
 */
function checkSimpleConflicts(items: KnowledgeItem[]): boolean {
  const contents = items.map(item => item.content.toLowerCase())
  
  console.log(`🔍 Checking ${items.length} similar items for conflicts:`)
  items.forEach((item, index) => {
    console.log(`   ${index + 1}. ${item.content.substring(0, 100)}...`)
  })
  
  // Look for conflicts
  for (let i = 0; i < contents.length; i++) {
    for (let j = i + 1; j < contents.length; j++) {
      const text1 = contents[i]
      const text2 = contents[j]
      
      // Universal opposite pairs (German, English, and others)
      const oppositePatterns = [
        // German opposites
        ['immer', 'nie'], ['immer', 'niemals'], ['immer', 'never'],
        ['alle', 'keine'], ['alle', 'niemand'], ['all', 'none'],
        ['ja', 'nein'], ['yes', 'no'], ['oui', 'non'],
        ['wahr', 'falsch'], ['true', 'false'], ['vrai', 'faux'],
        ['möglich', 'unmöglich'], ['possible', 'impossible'],
        ['verfügbar', 'nicht verfügbar'], ['available', 'unavailable'],
        ['inklusive', 'exklusive'], ['inclusive', 'exclusive'],
        ['kostenlos', 'kostenpflichtig'], ['free', 'paid'], ['gratuit', 'payant'],
        ['gratis', 'kostenpflichtig'], ['öffentlich', 'privat'], ['public', 'private'],
        ['erlaubt', 'verboten'], ['allowed', 'forbidden'], ['autorisé', 'interdit'],
        ['aktiv', 'inaktiv'], ['active', 'inactive'], ['actif', 'inactif'],
        ['an', 'aus'], ['on', 'off'], ['open', 'closed'], ['ouvert', 'fermé'],
        // Food preferences (for Ellen example)
        ['pizza', 'burger'], ['kaffee', 'tee'], ['coffee', 'tea'],
        // Qualifiers
        ['auch', 'nur'], ['also', 'only'], ['aussi', 'seulement']
      ]
      
      // Check for opposite patterns
      for (const [word1, word2] of oppositePatterns) {
        if ((text1.includes(word1) && text2.includes(word2)) || 
            (text1.includes(word2) && text2.includes(word1))) {
          console.log(`⚠️  Conflict found: "${word1}" vs "${word2}"`)
          return true
        }
      }
      
      // Free vs price conflicts (universal currency patterns)
      const freeTerms = ['kostenlos', 'gratis', 'kostenfrei', 'free', 'gratuit', 'libre']
      const pricePattern = /\d+(?:[,.]\d+)?\s*(?:€|euro|eur|\$|dollar|usd|£|pound|gbp|¥|yen|jpy)/i
      
      for (const freeTerm of freeTerms) {
        if ((text1.includes(freeTerm) && text2.match(pricePattern)) ||
            (text2.includes(freeTerm) && text1.match(pricePattern))) {
          console.log(`⚠️  Conflict found: "${freeTerm}" vs price`)
          return true
        }
      }
      
      // Check for delivery time conflicts (different day ranges)
      const days1 = text1.match(/(\d+)(?:-(\d+))?\s*(?:werk)?tag/i)
      const days2 = text2.match(/(\d+)(?:-(\d+))?\s*(?:werk)?tag/i)
      
      if (days1 && days2) {
        const min1 = parseInt(days1[1])
        const max1 = days1[2] ? parseInt(days1[2]) : min1
        const min2 = parseInt(days2[1])
        const max2 = days2[2] ? parseInt(days2[2]) : min2
        
        // If ranges don't overlap, it's a conflict
        if (max1 < min2 || max2 < min1) {
          console.log(`⚠️  Conflict found: delivery time conflict (${min1}-${max1} vs ${min2}-${max2} days)`)
          return true
        }
      }
      
      // Check for price conflicts (same product, different prices)
      const price1 = text1.match(/(\d+(?:[,.]\d{1,2})?)\s*(?:€|euro|eur)/i)
      const price2 = text2.match(/(\d+(?:[,.]\d{1,2})?)\s*(?:€|euro|eur)/i)
      
      if (price1 && price2) {
        const p1 = parseFloat(price1[1].replace(',', '.'))
        const p2 = parseFloat(price2[1].replace(',', '.'))
        if (Math.abs(p1 - p2) > 0.01) { // Allow small rounding differences
          console.log(`⚠️  Conflict found: price difference (${p1}€ vs ${p2}€)`)
          return true
        }
      }
      
      // Check for number conflicts (different quantities)
      const num1 = text1.match(/(\d+)\s*(tage|tag|stunden|stunde|minuten|minute|jahre|jahr|monate|monat)/i)
      const num2 = text2.match(/(\d+)\s*(tage|tag|stunden|stunde|minuten|minute|jahre|jahr|monate|monat)/i)
      
      if (num1 && num2 && num1[2] === num2[2]) { // Same unit
        const n1 = parseInt(num1[1])
        const n2 = parseInt(num2[1])
        if (n1 !== n2) {
          console.log(`⚠️  Conflict found: number difference (${n1} vs ${n2} ${num1[2]})`)
          return true
        }
      }
      
      // Check for percentage conflicts
      const pct1 = text1.match(/(\d+(?:[,.]\d+)?)\s*%/i)
      const pct2 = text2.match(/(\d+(?:[,.]\d+)?)\s*%/i)
      
      if (pct1 && pct2) {
        const p1 = parseFloat(pct1[1].replace(',', '.'))
        const p2 = parseFloat(pct2[1].replace(',', '.'))
        if (Math.abs(p1 - p2) > 1) { // Allow 1% difference
          console.log(`⚠️  Conflict found: percentage difference (${p1}% vs ${p2}%)`)
          return true
        }
      }
    }
  }
  
  console.log(`✅ No conflicts found in this group`)
  return false
}

/**
 * Calculate cosine similarity between two embedding vectors
 * Returns a value between 0 and 1
 */
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) return 0
  
  let dotProduct = 0
  let normA = 0
  let normB = 0
  
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i]
    normA += vecA[i] * vecA[i]
    normB += vecB[i] * vecB[i]
  }
  
  const denominator = Math.sqrt(normA) * Math.sqrt(normB)
  if (denominator === 0) return 0
  
  const similarity = dotProduct / denominator
  // Ensure the result is between 0 and 1 (cosine similarity can be -1 to 1, but we want 0 to 1)
  return Math.max(0, Math.min(1, similarity))
}

/**
 * Extract main topic from a group of items
 */
function extractTopicFromGroup(items: KnowledgeItem[]): string {
  // Find common keywords across all items
  const allWords = items.flatMap(item => 
    item.content.toLowerCase()
      .split(/\s+/)
      .filter(word => word.length > 3)
      .filter(word => !['der', 'die', 'das', 'und', 'oder', 'ist', 'sind', 'hat', 'haben', 'wird', 'werden', 'kann', 'können', 'soll', 'sollte', 'muss', 'müssen', 'auch', 'noch', 'nur', 'aber', 'wenn', 'dann', 'bei', 'von', 'für', 'mit', 'nach', 'vor', 'über', 'unter', 'zwischen', 'durch', 'ohne', 'gegen', 'während', 'wegen', 'trotz', 'the', 'and', 'or', 'is', 'are', 'has', 'have', 'will', 'can', 'should', 'must', 'also', 'only', 'but', 'if', 'then', 'with', 'for', 'from', 'to', 'by', 'at', 'on', 'in', 'of', 'about', 'over', 'under', 'between', 'through', 'without', 'against', 'during', 'because', 'despite'].includes(word))
  )
  
  // Count word frequencies
  const wordCount: { [key: string]: number } = {}
  allWords.forEach(word => {
    wordCount[word] = (wordCount[word] || 0) + 1
  })
  
  // Find most common words that appear in multiple items
  const commonWords = Object.entries(wordCount)
    .filter(([word, count]) => count >= Math.min(2, items.length))
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([word]) => word)
  
  return commonWords.join(', ') || 'Unbekanntes Thema'
}

/**
 * Calculate similarity score for a group
 * Returns a percentage value between 0 and 100
 */
function calculateGroupSimilarity(items: KnowledgeItem[]): number {
  if (items.length < 2) return 0
  
  let totalSimilarity = 0
  let comparisons = 0
  
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (items[i].embedding && items[j].embedding) {
        const similarity = cosineSimilarity(items[i].embedding!, items[j].embedding!)
        totalSimilarity += similarity
        comparisons++
      }
    }
  }
  
  if (comparisons === 0) return 0
  
  const avgSimilarity = totalSimilarity / comparisons
  const percentage = Math.round(avgSimilarity * 100)
  
  // Ensure the result is between 0 and 100
  return Math.max(0, Math.min(100, percentage))
}

/**
 * Extract key value from content (simplified)
 */
function extractKeyValue(content: string): string {
  // Extract prices, numbers, or key phrases
  const priceMatch = content.match(/\d+(?:[,.]\d{1,2})?\s*(?:€|euro|eur|$|dollar|£|pound)/i)
  if (priceMatch) return priceMatch[0]
  
  const numberMatch = content.match(/\d+(?:[,.]\d+)?\s*(?:tage|tag|prozent|%|stunden|stunde|minuten|minute|jahre|jahr|monate|monat|wochen|woche|days|day|percent|hours|hour|minutes|minute|years|year|months|month|weeks|week)/i)
  if (numberMatch) return numberMatch[0]
  
  // Return first few words as key value
  const words = content.split(/\s+/).slice(0, 5)
  return words.join(' ') + (content.split(/\s+/).length > 5 ? '...' : '')
} 