import { OpenAI } from 'openai';
import 'dotenv/config';

export class RelevanceScorer {
  private openai: OpenAI;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not configured for RelevanceScorer');
    }
    this.openai = new OpenAI({ apiKey });
  }

  async score(query: string, response: string): Promise<number> {
    const prompt = `
    You are an impartial judge evaluating the relevance of an AI agent's response to a user's query.
    
    User Query: "${query}"
    Agent Response: "${response}"
    
    Rate the relevance of the response on a scale from 0.0 to 1.0, where:
    - 0.0: Completely irrelevant, hallucinated, or does not answer the question.
    - 0.5: Partially relevant but misses key details or includes unnecessary information.
    - 1.0: Perfectly relevant, direct, and helpful.
    
    Output ONLY the numeric score (e.g., 0.85).
    `;

    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
      });

      const content = completion.choices[0]?.message?.content?.trim();
      const score = parseFloat(content ?? '0');

      return isNaN(score) ? 0 : score;
    } catch (error) {
      console.error('RelevanceScorer failed:', error);
      return 0;
    }
  }
}

export const relevanceScorer = new RelevanceScorer();

