import OpenAI from "openai";

export default class AiClient {
  private env: CloudflareBindings;

  private models = {
    openai: [
      "gpt-4o",
      "gpt-4-turbo",
      "gpt-3.5-turbo",
      "o3-mini",
      "o1",
      "o1-mini",
    ],
    anthropic: [
      "claude-3-7-sonnet-latest",
      "claude-3-5-sonnet-latest",
      "claude-3-5-haiku-latest",
      "claude-3-opus-latest",
    ],
    qwen: [
      "qwen2.5-7b-instruct",
      "qwen2.5-14b-instruct",
      "qwen-max",
      "qwen-plus",
      "qwen-turbo",
    ],
    mistral: [
      "ministral-3b-latest",
      "codestral-latest",
      "mistral-large-latest",
      "pixtral-large-latest",
      "ministral-8b-latest",
    ],
  };

  private baseUrl =
    "https://gateway.ai.cloudflare.com/v1/485970843693dfad3d42377c66e89309/wat-ai";

  constructor(env: CloudflareBindings) {
    this.env = env;
  }

  async chat(model: string, prompt: string): Promise<string | null> {
    const client = this.getClient(model);

    if (client === null) {
      return Promise.reject("model is invalid");
    }

    const response = await client.chat.completions.create({
      model: model,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    return response.choices[0].message.content;
  }

  private getClient(model: string): OpenAI | null {
    if (this.models.openai.includes(model)) {
      return new OpenAI({
        apiKey: this.env.OPENAI_API_KEY,
        baseURL: `${this.baseUrl}/openai`,
      });
    } else if (this.models.anthropic.includes(model)) {
      return new OpenAI({
        apiKey: this.env.CLAUDEAI_API_KEY,
        baseURL: `${this.baseUrl}/anthropic`,
      });
    } else if (this.models.mistral.includes(model)) {
      return new OpenAI({
        apiKey: this.env.MISTRAL_API_KEY,
        baseURL: `${this.baseUrl}/mistral`,
      });
    } else if (this.models.qwen.includes(model)) {
      return new OpenAI({
        apiKey: this.env.QWEN_API_KEY,
        baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/",
      });
    } else {
      return null;
    }
  }
}
