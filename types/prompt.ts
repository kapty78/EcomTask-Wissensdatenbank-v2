/**
 * Special command keys used in chat interactions for specific functionality
 */
export enum SpecialCommandKey {
  // Slash commands for prompts
  SLASH = '/',
  
  // Hashtag commands for file references
  HASHTAG = '#',
  
  // Tool commands for tool selection
  TOOL = '!',
  
  // At commands for assistant selection
  AT = '@'
}

/**
 * Interface for structured prompts
 */
export interface Prompt {
  id: string
  content: string
  name: string
}

/**
 * Command processing result
 */
export interface CommandResult {
  type: string
  content: string
  isProcessed: boolean
} 