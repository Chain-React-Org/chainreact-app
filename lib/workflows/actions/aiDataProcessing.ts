/**
 * AI Data Processing Actions
 * Actions that can process and transform data from previous workflow nodes
 */

import type { ActionResult } from '@/lib/workflows/actions/core/executeWait'
import { getOpenAIClient } from '@/lib/ai/openai-client'

/**
 * Summarize text content using AI
 */
export async function summarizeContent(
  config: {
    inputText: string
    maxLength?: number
    style?: 'brief' | 'detailed' | 'bullet_points'
    focus?: string
  },
  userId: string,
  input: any
): Promise<ActionResult> {
  try {
    const { inputText, maxLength = 200, style = 'brief', focus } = config
    
    if (!inputText) {
      return {
        success: false,
        output: undefined,
        message: 'No input text provided for summarization'
      }
    }

    let prompt = `Please summarize the following text in a ${style} style`
    if (maxLength) {
      prompt += ` (maximum ${maxLength} characters)`
    }
    if (focus) {
      prompt += `. Focus on: ${focus}`
    }
    prompt += `:\n\n${inputText}`

    const completion = await getOpenAIClient().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a helpful assistant that creates clear, accurate summaries of text content.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: Math.min(maxLength * 2, 1000),
      temperature: 0.3
    })

    const summary = completion.choices[0]?.message?.content?.trim()

    return {
      success: true,
      output: {
        summary,
        originalLength: inputText.length,
        summaryLength: summary?.length || 0,
        style,
        focus
      },
      message: 'Content summarized successfully'
    }
  } catch (error: any) {
    return {
      success: false,
      output: undefined,
      message: `Failed to summarize content: ${error.message}`
    }
  }
}

/**
 * Extract specific information from text using AI
 */
export async function extractInformation(
  config: {
    inputText: string
    extractionType: 'emails' | 'phone_numbers' | 'dates' | 'names' | 'urls' | 'custom'
    customPrompt?: string
    returnFormat?: 'list' | 'json' | 'text'
  },
  userId: string,
  input: any
): Promise<ActionResult> {
  try {
    const { inputText, extractionType, customPrompt, returnFormat = 'list' } = config
    
    if (!inputText) {
      return {
        success: false,
        output: undefined,
        message: 'No input text provided for extraction'
      }
    }

    let systemPrompt = 'You are a helpful assistant that extracts specific information from text.'
    let userPrompt = `Extract ${extractionType} from the following text`

    if (extractionType === 'custom' && customPrompt) {
      userPrompt = customPrompt
    } else {
      switch (extractionType) {
        case 'emails':
          userPrompt += ' (email addresses)'
          break
        case 'phone_numbers':
          userPrompt += ' (phone numbers)'
          break
        case 'dates':
          userPrompt += ' (dates in any format)'
          break
        case 'names':
          userPrompt += ' (person names)'
          break
        case 'urls':
          userPrompt += ' (URLs and links)'
          break
      }
    }

    if (returnFormat === 'json') {
      systemPrompt += ' Return the results as valid JSON.'
      userPrompt += '. Return as JSON array.'
    } else if (returnFormat === 'list') {
      userPrompt += '. Return as a simple list, one item per line.'
    }

    userPrompt += `:\n\n${inputText}`

    const completion = await getOpenAIClient().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: 500,
      temperature: 0.1
    })

    const extracted = completion.choices[0]?.message?.content?.trim()

    // Try to parse as JSON if that was requested
    let parsedData = extracted
    if (returnFormat === 'json' && extracted) {
      try {
        parsedData = JSON.parse(extracted)
      } catch {
        // If JSON parsing fails, return as text
        parsedData = extracted
      }
    }

    return {
      success: true,
      output: {
        extracted: parsedData,
        extractionType,
        returnFormat,
        originalText: inputText
      },
      message: `Successfully extracted ${extractionType}`
    }
  } catch (error: any) {
    return {
      success: false,
      output: null,
      message: `Failed to extract information: ${error.message}`
    }
  }
}

/**
 * Analyze sentiment of text content
 */
export async function analyzeSentiment(
  config: {
    inputText: string
    analysisType?: 'basic' | 'detailed' | 'emotions'
  },
  userId: string,
  input: any
): Promise<ActionResult> {
  try {
    const { inputText, analysisType = 'basic' } = config
    
    if (!inputText) {
      return {
        success: false,
        output: null,
        message: 'No input text provided for sentiment analysis'
      }
    }

    let prompt = `Analyze the sentiment of the following text`
    if (analysisType === 'detailed') {
      prompt += ' and provide a detailed analysis including confidence score'
    } else if (analysisType === 'emotions') {
      prompt += ' and identify specific emotions present'
    } else {
      prompt += ' and classify as positive, negative, or neutral'
    }
    prompt += `:\n\n${inputText}`

    const completion = await getOpenAIClient().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a sentiment analysis expert. Provide clear, accurate sentiment analysis.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 300,
      temperature: 0.1
    })

    const analysis = completion.choices[0]?.message?.content?.trim()

    return {
      success: true,
      output: {
        analysis,
        analysisType,
        originalText: inputText,
        timestamp: new Date().toISOString()
      },
      message: 'Sentiment analysis completed successfully'
    }
  } catch (error: any) {
    return {
      success: false,
      output: null,
      message: `Failed to analyze sentiment: ${error.message}`
    }
  }
}

/**
 * Translate text to different languages
 */
export async function translateText(
  config: {
    inputText: string
    targetLanguage: string
    sourceLanguage?: string
    preserveFormatting?: boolean
  },
  userId: string,
  input: any
): Promise<ActionResult> {
  try {
    const { inputText, targetLanguage, sourceLanguage, preserveFormatting = true } = config
    
    if (!inputText) {
      return {
        success: false,
        output: null,
        message: 'No input text provided for translation'
      }
    }

    if (!targetLanguage) {
      return {
        success: false,
        output: null,
        message: 'Target language is required'
      }
    }

    let prompt = `Translate the following text to ${targetLanguage}`
    if (sourceLanguage) {
      prompt += ` from ${sourceLanguage}`
    }
    if (preserveFormatting) {
      prompt += '. Preserve all formatting, line breaks, and structure.'
    }
    prompt += `:\n\n${inputText}`

    const completion = await getOpenAIClient().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a professional translator. Provide accurate, natural translations.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: Math.min(inputText.length * 2, 2000),
      temperature: 0.3
    })

    const translation = completion.choices[0]?.message?.content?.trim()

    return {
      success: true,
      output: {
        translation,
        targetLanguage,
        sourceLanguage: sourceLanguage || 'auto-detected',
        originalText: inputText,
        preserveFormatting
      },
      message: `Text translated to ${targetLanguage} successfully`
    }
  } catch (error: any) {
    return {
      success: false,
      output: null,
      message: `Failed to translate text: ${error.message}`
    }
  }
}

/**
 * Generate content based on input data
 */
export async function generateContent(
  config: {
    inputData: any
    contentType: 'email' | 'report' | 'summary' | 'response' | 'custom'
    template?: string
    tone?: 'professional' | 'casual' | 'friendly' | 'formal'
    length?: 'short' | 'medium' | 'long'
  },
  userId: string,
  input: any
): Promise<ActionResult> {
  try {
    const { inputData, contentType, template, tone = 'professional', length = 'medium' } = config
    
    if (!inputData) {
      return {
        success: false,
        output: null,
        message: 'No input data provided for content generation'
      }
    }

    let prompt = `Generate ${contentType} content`
    if (tone) prompt += ` with a ${tone} tone`
    if (length) prompt += ` (${length} length)`
    
    if (template) {
      prompt += ` using this template: ${template}`
    } else {
      prompt += ` based on the following data`
    }
    
    prompt += `:\n\n${JSON.stringify(inputData, null, 2)}`

    const completion = await getOpenAIClient().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a professional content writer specializing in ${contentType} creation.`
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: length === 'long' ? 1500 : length === 'medium' ? 800 : 400,
      temperature: 0.7
    })

    const generatedContent = completion.choices[0]?.message?.content?.trim()

    return {
      success: true,
      output: {
        content: generatedContent,
        contentType,
        tone,
        length,
        inputData,
        timestamp: new Date().toISOString()
      },
      message: `${contentType} content generated successfully`
    }
  } catch (error: any) {
    return {
      success: false,
      output: null,
      message: `Failed to generate content: ${error.message}`
    }
  }
}

/**
 * Classify or categorize content
 */
export async function classifyContent(
  config: {
    inputText: string
    categories: string[]
    confidence?: boolean
  },
  userId: string,
  input: any
): Promise<ActionResult> {
  try {
    const { inputText, categories: rawCategories, confidence = false } = config

    if (!inputText) {
      return {
        success: false,
        output: null,
        message: 'No input text provided for classification'
      }
    }

    // Normalize categories: accept string (comma-separated) or array
    const categories: string[] = Array.isArray(rawCategories)
      ? rawCategories
      : typeof rawCategories === 'string'
        ? rawCategories.split(',').map((c: string) => c.trim()).filter(Boolean)
        : []

    if (!categories || categories.length === 0) {
      return {
        success: false,
        output: null,
        message: 'No categories provided for classification'
      }
    }

    let prompt = `Classify the following text into one of these categories: ${categories.join(', ')}`
    if (confidence) {
      prompt += '. Also provide a confidence score (0-100).'
    }
    prompt += `:\n\n${inputText}`

    const completion = await getOpenAIClient().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a content classification expert. Choose the most appropriate category.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 200,
      temperature: 0.1
    })

    const classification = completion.choices[0]?.message?.content?.trim()

    return {
      success: true,
      output: {
        classification,
        categories,
        confidence,
        originalText: inputText,
        timestamp: new Date().toISOString()
      },
      message: 'Content classified successfully'
    }
  } catch (error: any) {
    return {
      success: false,
      output: null,
      message: `Failed to classify content: ${error.message}`
    }
  }
} 