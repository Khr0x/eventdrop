import { describe, it, expect } from "vitest";
import { EventProcessorService } from "../src/services/event-processor.service";

const processor = new EventProcessorService();

describe("EventProcessorService", () => {
  describe("categorization by type prefix", () => {
    it('categorizes "payment.*" as PAYMENT', () => {
      const result = processor.process("payment.completed", {});
      expect(result.category).toBe("PAYMENT");
    });

    it('categorizes "order.*" as ORDERS', () => {
      const result = processor.process("order.created", {});
      expect(result.category).toBe("ORDERS");
    });

    it('categorizes "user.*" as USERS', () => {
      const result = processor.process("user.registered", {});
      expect(result.category).toBe("USERS");
    });

    it('categorizes "notification.*" as NOTIFICATION', () => {
      const result = processor.process("notification.email", {});
      expect(result.category).toBe("NOTIFICATION");
    });

    it("categorizes unknown types as UNKNOWN", () => {
      const result = processor.process("random.event", {});
      expect(result.category).toBe("UNKNOWN");
    });
  });

  describe("priority by type suffix", () => {
    it('assigns HIGH priority to "*.critical" events', () => {
      const result = processor.process("payment.failed.critical", {});
      expect(result.category).toBe("PAYMENT");
      expect(result.priority).toBe("HIGH");
    });

    it("assigns NORMAL priority by default", () => {
      const result = processor.process("order.created", {});
      expect(result.priority).toBe("NORMAL");
    });
  });

  describe("forced failure", () => {
    it('throws on "test.force_failure" type', () => {
      expect(() => processor.process("test.force_failure", {})).toThrow(
        "Forced processing failure for event type: test.force_failure"
      );
    });
  });
});
