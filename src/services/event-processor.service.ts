export interface ProcessResult {
  category: string;
  priority: string;
}

export class EventProcessorService {
  /**
   * Process an event: categorize based on type prefix and assign priority.
   * Throws for type "test.force_failure" to simulate processing failures.
   */
  process(
    eventType: string,
    _payload: Record<string, unknown>
  ): ProcessResult {
    // Forced failure for testing / DLQ verification
    if (eventType === "test.force_failure") {
      throw new Error(
        `Forced processing failure for event type: ${eventType}`
      );
    }

    const category = this.categorize(eventType);
    const priority = this.getPriority(eventType);

    return { category, priority };
  }

  /**
   * Map event type prefix to a category.
   */
  private categorize(eventType: string): string {
    if (eventType.startsWith("payment.")) return "PAYMENT";
    if (eventType.startsWith("order.")) return "ORDERS";
    if (eventType.startsWith("user.")) return "USERS";
    if (eventType.startsWith("notification.")) return "NOTIFICATION";
    return "UNKNOWN";
  }

  /**
   * Assign priority based on event type suffix.
   * Types ending in ".critical" get HIGH priority.
   */
  private getPriority(eventType: string): string {
    if (eventType.endsWith(".critical")) return "HIGH";
    return "NORMAL";
  }
}
