/**
 * Erweiterte Graph-Algorithmen für die Wissensdatenbank
 * 
 * Diese Datei enthält spezialisierte Algorithmen für:
 * - Ähnlichkeitsberechnungen
 * - Clustering von Wissenseinträgen  
 * - Community-Erkennung
 * - Zentralitätsmessungen
 * - Themen-Extraktion
 */

// Interfaces
export interface KnowledgeNode {
  id: string
  content: string
  title?: string
  embedding?: number[]
  keywords?: string[]
  metadata?: any
}

export interface SimilarityEdge {
  source: string
  target: string
  similarity: number
  type: 'semantic' | 'lexical' | 'structural'
}

export interface GraphCluster {
  id: string
  nodes: string[]
  centroid?: string
  topic?: string
  coherence: number
}

// Cosinus-Ähnlichkeit zwischen Embeddings
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0
  
  let dotProduct = 0
  let normA = 0
  let normB = 0
  
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i]
    normA += vecA[i] * vecA[i]
    normB += vecB[i] * vecB[i]
  }
  
  if (normA === 0 || normB === 0) return 0
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
}

// Jaccard-Ähnlichkeit für Keyword-Sets
export function jaccardSimilarity(setA: string[], setB: string[]): number {
  if (!setA || !setB || (setA.length === 0 && setB.length === 0)) return 0
  
  const intersection = setA.filter(item => setB.includes(item))
  const union = new Set([...setA, ...setB])
  
  return intersection.length / union.size
}

// Lexikale Ähnlichkeit (n-gram basiert)
export function lexicalSimilarity(textA: string, textB: string, nGramSize: number = 3): number {
  if (!textA || !textB) return 0
  
  const getNGrams = (text: string, n: number): string[] => {
    const cleanText = text.toLowerCase().replace(/[^\w\s]/g, '')
    const grams = []
    for (let i = 0; i <= cleanText.length - n; i++) {
      grams.push(cleanText.slice(i, i + n))
    }
    return grams
  }
  
  const nGramsA = getNGrams(textA, nGramSize)
  const nGramsB = getNGrams(textB, nGramSize)
  
  return jaccardSimilarity(nGramsA, nGramsB)
}

// Kombinierte Ähnlichkeitsmessung
export function calculateCombinedSimilarity(
  nodeA: KnowledgeNode,
  nodeB: KnowledgeNode,
  weights: { semantic: number; lexical: number; keyword: number } = { semantic: 0.6, lexical: 0.2, keyword: 0.2 }
): number {
  let semanticSim = 0
  let lexicalSim = 0
  let keywordSim = 0
  
  // Semantische Ähnlichkeit (Embeddings)
  if (nodeA.embedding && nodeB.embedding) {
    semanticSim = cosineSimilarity(nodeA.embedding, nodeB.embedding)
  }
  
  // Lexikale Ähnlichkeit
  if (nodeA.content && nodeB.content) {
    lexicalSim = lexicalSimilarity(nodeA.content, nodeB.content)
  }
  
  // Keyword-Ähnlichkeit
  if (nodeA.keywords && nodeB.keywords) {
    keywordSim = jaccardSimilarity(nodeA.keywords, nodeB.keywords)
  }
  
  return (
    semanticSim * weights.semantic +
    lexicalSim * weights.lexical +
    keywordSim * weights.keyword
  )
}

// TF-IDF Keyword-Extraktion
export function extractKeywordsTFIDF(
  documents: KnowledgeNode[],
  maxKeywords: number = 10
): Record<string, string[]> {
  const stopWords = new Set([
    'der', 'die', 'das', 'und', 'ist', 'in', 'auf', 'mit', 'für', 'zu', 'von', 'im', 'am',
    'ein', 'eine', 'einer', 'nicht', 'sich', 'auch', 'wird', 'werden', 'kann', 'hat', 'haben',
    'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'are'
  ])
  
  // Term-Frequenz berechnen
  const termFrequency = (text: string): Record<string, number> => {
    const words = text.toLowerCase()
      .replace(/[^\w\säöüß]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.has(word))
    
    const freq: Record<string, number> = {}
    words.forEach(word => {
      freq[word] = (freq[word] || 0) + 1
    })
    
    return freq
  }
  
  // Document-Frequenz berechnen
  const documentFrequency: Record<string, number> = {}
  const docTermFreqs = documents.map(doc => {
    const tf = termFrequency(doc.content || '')
    Object.keys(tf).forEach(term => {
      documentFrequency[term] = (documentFrequency[term] || 0) + 1
    })
    return tf
  })
  
  const totalDocs = documents.length
  
  // TF-IDF für jedes Dokument berechnen
  const result: Record<string, string[]> = {}
  
  documents.forEach((doc, index) => {
    const tf = docTermFreqs[index]
    const tfidf: Record<string, number> = {}
    
    Object.entries(tf).forEach(([term, frequency]) => {
      const idf = Math.log(totalDocs / (documentFrequency[term] || 1))
      tfidf[term] = frequency * idf
    })
    
    // Top Keywords extrahieren
    const keywords = Object.entries(tfidf)
      .sort(([, a], [, b]) => b - a)
      .slice(0, maxKeywords)
      .map(([term]) => term)
    
    result[doc.id] = keywords
  })
  
  return result
}

// K-Means Clustering für Wissenseinträge
export function clusterKnowledgeNodes(
  nodes: KnowledgeNode[],
  k: number = 5,
  maxIterations: number = 100
): GraphCluster[] {
  if (nodes.length === 0 || k <= 0) return []
  
  // Embeddings extrahieren (falls vorhanden)
  const embeddings = nodes
    .map(node => node.embedding)
    .filter(emb => emb && emb.length > 0) as number[][]
  
  if (embeddings.length < k) {
    // Fallback: einfache Gruppierung nach Ähnlichkeit
    return simpleClusteringFallback(nodes, k)
  }
  
  const dimension = embeddings[0].length
  
  // Zufällige Zentroiden initialisieren
  let centroids: number[][] = []
  for (let i = 0; i < k; i++) {
    const centroid = new Array(dimension).fill(0).map(() => Math.random() - 0.5)
    centroids.push(centroid)
  }
  
  let clusters: GraphCluster[] = []
  
  for (let iteration = 0; iteration < maxIterations; iteration++) {
    // Cluster-Zuweisungen
    const assignments: number[] = []
    const clusterNodes: string[][] = Array(k).fill(null).map(() => [])
    
    nodes.forEach((node, nodeIndex) => {
      if (!node.embedding) return
      
      let bestCluster = 0
      let bestDistance = Infinity
      
      centroids.forEach((centroid, clusterIndex) => {
        const distance = 1 - cosineSimilarity(node.embedding!, centroid)
        if (distance < bestDistance) {
          bestDistance = distance
          bestCluster = clusterIndex
        }
      })
      
      assignments[nodeIndex] = bestCluster
      clusterNodes[bestCluster].push(node.id)
    })
    
    // Zentroiden neu berechnen
    const newCentroids: number[][] = []
    
    for (let c = 0; c < k; c++) {
      const clusterEmbeddings = clusterNodes[c]
        .map(nodeId => nodes.find(n => n.id === nodeId)?.embedding)
        .filter(emb => emb) as number[][]
      
      if (clusterEmbeddings.length === 0) {
        // Leeres Cluster: zufälligen Zentroid beibehalten
        newCentroids.push(centroids[c])
        continue
      }
      
      // Mittelwert berechnen
      const newCentroid = new Array(dimension).fill(0)
      clusterEmbeddings.forEach(embedding => {
        embedding.forEach((value, i) => {
          newCentroid[i] += value / clusterEmbeddings.length
        })
      })
      
      newCentroids.push(newCentroid)
    }
    
    // Konvergenz prüfen
    const converged = centroids.every((centroid, i) => 
      cosineSimilarity(centroid, newCentroids[i]) > 0.99
    )
    
    centroids = newCentroids
    
    if (converged) break
  }
  
  // Finale Cluster erstellen
  clusters = centroids.map((centroid, index) => {
    const clusterNodeIds = nodes
      .filter(node => {
        if (!node.embedding) return false
        const distances = centroids.map(c => 1 - cosineSimilarity(node.embedding!, c))
        return distances.indexOf(Math.min(...distances)) === index
      })
      .map(node => node.id)
    
    return {
      id: `cluster-${index}`,
      nodes: clusterNodeIds,
      coherence: calculateClusterCoherence(clusterNodeIds, nodes),
      topic: extractClusterTopic(clusterNodeIds, nodes)
    }
  }).filter(cluster => cluster.nodes.length > 0)
  
  return clusters
}

// Fallback-Clustering ohne Embeddings
function simpleClusteringFallback(nodes: KnowledgeNode[], k: number): GraphCluster[] {
  const clusters: GraphCluster[] = []
  const nodesPerCluster = Math.ceil(nodes.length / k)
  
  for (let i = 0; i < k; i++) {
    const start = i * nodesPerCluster
    const end = Math.min(start + nodesPerCluster, nodes.length)
    const clusterNodes = nodes.slice(start, end)
    
    if (clusterNodes.length > 0) {
      clusters.push({
        id: `cluster-${i}`,
        nodes: clusterNodes.map(n => n.id),
        coherence: 0.5, // Placeholder
        topic: `Thema ${i + 1}`
      })
    }
  }
  
  return clusters
}

// Cluster-Kohärenz berechnen
function calculateClusterCoherence(nodeIds: string[], allNodes: KnowledgeNode[]): number {
  const clusterNodes = allNodes.filter(node => nodeIds.includes(node.id))
  
  if (clusterNodes.length < 2) return 1
  
  let totalSimilarity = 0
  let pairCount = 0
  
  for (let i = 0; i < clusterNodes.length; i++) {
    for (let j = i + 1; j < clusterNodes.length; j++) {
      const similarity = calculateCombinedSimilarity(clusterNodes[i], clusterNodes[j])
      totalSimilarity += similarity
      pairCount++
    }
  }
  
  return pairCount > 0 ? totalSimilarity / pairCount : 0
}

// Cluster-Thema extrahieren
function extractClusterTopic(nodeIds: string[], allNodes: KnowledgeNode[]): string {
  const clusterNodes = allNodes.filter(node => nodeIds.includes(node.id))
  
  // Häufigste Keywords sammeln
  const keywordFreq: Record<string, number> = {}
  clusterNodes.forEach(node => {
    if (node.keywords) {
      node.keywords.forEach(keyword => {
        keywordFreq[keyword] = (keywordFreq[keyword] || 0) + 1
      })
    }
  })
  
  // Top-Keyword als Thema verwenden
  const sortedKeywords = Object.entries(keywordFreq)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([keyword]) => keyword)
  
  return sortedKeywords.join(', ') || 'Unbekanntes Thema'
}

// Community-Erkennung (Louvain-ähnlicher Algorithmus, vereinfacht)
export function detectCommunities(
  nodes: KnowledgeNode[],
  edges: SimilarityEdge[],
  minCommunitySize: number = 2
): GraphCluster[] {
  // Adjacency-Liste erstellen
  const adjacency: Record<string, Array<{ target: string; weight: number }>> = {}
  
  nodes.forEach(node => {
    adjacency[node.id] = []
  })
  
  edges.forEach(edge => {
    adjacency[edge.source].push({ target: edge.target, weight: edge.similarity })
    adjacency[edge.target].push({ target: edge.source, weight: edge.similarity })
  })
  
  // Initiale Communites (jeder Knoten ist eine Community)
  const communities: Record<string, string> = {}
  nodes.forEach(node => {
    communities[node.id] = node.id
  })
  
  let improved = true
  let iteration = 0
  const maxIterations = 10
  
  while (improved && iteration < maxIterations) {
    improved = false
    iteration++
    
    // Für jeden Knoten prüfen, ob Community-Wechsel die Modularität verbessert
    for (const node of nodes) {
      const currentCommunity = communities[node.id]
      const neighborCommunities = new Set<string>()
      
      // Nachbar-Communities sammeln
      adjacency[node.id].forEach(neighbor => {
        neighborCommunities.add(communities[neighbor.target])
      })
      
      let bestCommunity = currentCommunity
      let bestGain = 0
      
      // Prüfe jede Nachbar-Community
      neighborCommunities.forEach(community => {
        if (community !== currentCommunity) {
          const gain = calculateModularityGain(node.id, community, communities, adjacency)
          if (gain > bestGain) {
            bestGain = gain
            bestCommunity = community
          }
        }
      })
      
      // Community wechseln wenn Verbesserung
      if (bestCommunity !== currentCommunity) {
        communities[node.id] = bestCommunity
        improved = true
      }
    }
  }
  
  // Communities zu Clustern konvertieren
  const communityGroups: Record<string, string[]> = {}
  Object.entries(communities).forEach(([nodeId, communityId]) => {
    if (!communityGroups[communityId]) {
      communityGroups[communityId] = []
    }
    communityGroups[communityId].push(nodeId)
  })
  
  // Nur Communities mit Mindestgröße beibehalten
  const clusters: GraphCluster[] = Object.entries(communityGroups)
    .filter(([, nodeIds]) => nodeIds.length >= minCommunitySize)
    .map(([communityId, nodeIds], index) => ({
      id: `community-${index}`,
      nodes: nodeIds,
      coherence: calculateClusterCoherence(nodeIds, nodes),
      topic: extractClusterTopic(nodeIds, nodes)
    }))
  
  return clusters
}

// Modularitäts-Gewinn berechnen (vereinfacht)
function calculateModularityGain(
  nodeId: string,
  targetCommunity: string,
  communities: Record<string, string>,
  adjacency: Record<string, Array<{ target: string; weight: number }>>
): number {
  // Vereinfachte Berechnung - in der Praxis würde man die vollständige Modularitätsformel verwenden
  let internalWeight = 0
  let externalWeight = 0
  
  adjacency[nodeId].forEach(neighbor => {
    if (communities[neighbor.target] === targetCommunity) {
      internalWeight += neighbor.weight
    } else {
      externalWeight += neighbor.weight
    }
  })
  
  return internalWeight - externalWeight
}

// Zentralitätsmessungen
export function calculateNodeCentrality(
  nodeId: string,
  nodes: KnowledgeNode[],
  edges: SimilarityEdge[]
): {
  degree: number
  betweenness: number
  closeness: number
  pagerank: number
} {
  // Degree-Zentralität
  const degree = edges.filter(edge => 
    edge.source === nodeId || edge.target === nodeId
  ).length
  
  // Vereinfachte Berechnungen (in der Praxis würde man spezialisierte Graph-Algorithmen verwenden)
  const betweenness = 0 // Placeholder für Betweenness-Zentralität
  const closeness = degree > 0 ? 1 / degree : 0 // Vereinfachte Closeness
  const pagerank = 0.15 + 0.85 * (degree / nodes.length) // Vereinfachte PageRank
  
  return {
    degree,
    betweenness,
    closeness,
    pagerank
  }
}