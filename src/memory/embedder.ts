export interface Embedder {
  readonly dimensions: number;
  embed(text: string): Promise<Float32Array>;
}

export class OllamaEmbedder implements Embedder {
  readonly dimensions = 768;

  constructor(
    private baseUrl: string = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
    private model: string = process.env.OLLAMA_MODEL ?? 'nomic-embed-text',
  ) {}

  async embed(text: string): Promise<Float32Array> {
    if (!text || text.trim().length === 0) {
      throw new Error('embed 文本不能为空');
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, prompt: text }),
      });
    } catch {
      throw new Error(`Ollama 服务不可用 (${this.baseUrl})`);
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Embedding API 错误: ${response.status} ${body}`);
    }

    const data = (await response.json()) as { embeddings: number[][] };
    const raw = data.embeddings[0];
    if (!raw || raw.length !== 768) {
      throw new Error(`Embedding API 返回了非预期的维度: ${raw?.length}`);
    }

    const vec = new Float32Array(raw);
    this.normalize(vec);
    return vec;
  }

  private normalize(vec: Float32Array): void {
    let sum = 0;
    for (let i = 0; i < vec.length; i++) sum += vec[i] * vec[i];
    const len = Math.sqrt(sum);
    if (len > 0) {
      for (let i = 0; i < vec.length; i++) vec[i] /= len;
    }
  }
}
