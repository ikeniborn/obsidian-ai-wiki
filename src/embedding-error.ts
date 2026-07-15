/** Thrown when the embedding endpoint genuinely fails for a whole entity set. */
export class EmbeddingUnavailableError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "EmbeddingUnavailableError";
  }
}
