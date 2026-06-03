import OpenAI from "openai";

// Vereinfachte Funktion zum Initialisieren des OpenAI-Clients
function initializeOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("OpenAI API Key not found in environment variables.");
    throw new Error("OpenAI API Key is missing.");
  }
  return new OpenAI({
    apiKey: apiKey
  });
}

// Diese Funktion ist nun ein Wrapper, der statt lokaler Embeddings OpenAI verwendet
export async function generateLocalEmbedding(content: string): Promise<number[]> {
  try {
    console.log("Verwende OpenAI statt lokaler Embeddings");
    const openai = initializeOpenAIClient();
    
    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: content
    });
    
    return response.data[0].embedding;
  } catch (error) {
    console.error("Fehler beim Generieren von Embeddings:", error);
    // Gib ein leeres Array zurück, damit die Anwendung nicht abstürzt
    return [];
  }
}
