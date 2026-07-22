import { describe, it, expect } from "vitest";
import { MockAIService } from "../ai/MockAIService.js";
import { AIMessage, GenerateAIRequest } from "../ai/types.js";

/** A minimal valid request used across tests. */
function sampleRequest(overrides: Partial<GenerateAIRequest> = {}): GenerateAIRequest {
  return {
    messages: [{ role: "user", content: "Hello" }],
    ...overrides,
  };
}

describe("MockAIService", () => {
  // ------------------------------------------------------------------
  // Default behaviour
  // ------------------------------------------------------------------
  it("implements generate() and returns the default content", async () => {
    const service = new MockAIService();
    const response = await service.generate(sampleRequest());

    expect(response.content).toBe("Mock AI response");
  });

  it("returns the default model", async () => {
    const service = new MockAIService();
    const response = await service.generate(sampleRequest());

    expect(response.model).toBe("mock-ai");
  });

  // ------------------------------------------------------------------
  // Configuration
  // ------------------------------------------------------------------
  it("supports configured content", async () => {
    const service = new MockAIService({ content: "Custom response" });
    const response = await service.generate(sampleRequest());

    expect(response.content).toBe("Custom response");
  });

  it("supports configured model", async () => {
    const service = new MockAIService({ model: "test-model-v1" });
    const response = await service.generate(sampleRequest());

    expect(response.model).toBe("test-model-v1");
  });

  it("supports configured usage", async () => {
    const service = new MockAIService({
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    });
    const response = await service.generate(sampleRequest());

    expect(response.usage).toEqual({
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
    });
  });

  // ------------------------------------------------------------------
  // Request recording
  // ------------------------------------------------------------------
  it("records each request", async () => {
    const service = new MockAIService();

    await service.generate(sampleRequest({ messages: [{ role: "user", content: "First" }] }));
    await service.generate(sampleRequest({ messages: [{ role: "user", content: "Second" }] }));

    const history = service.getRequests();
    expect(history).toHaveLength(2);
  });

  it("preserves request order", async () => {
    const service = new MockAIService();

    await service.generate(sampleRequest({ messages: [{ role: "user", content: "A" }] }));
    await service.generate(sampleRequest({ messages: [{ role: "user", content: "B" }] }));
    await service.generate(sampleRequest({ messages: [{ role: "user", content: "C" }] }));

    const history = service.getRequests();
    expect(history[0].messages[0].content).toBe("A");
    expect(history[1].messages[0].content).toBe("B");
    expect(history[2].messages[0].content).toBe("C");
  });

  it("clearRequests() clears history", async () => {
    const service = new MockAIService();

    await service.generate(sampleRequest());
    expect(service.getRequests()).toHaveLength(1);

    service.clearRequests();
    expect(service.getRequests()).toHaveLength(0);
  });

  // ------------------------------------------------------------------
  // Defensive copy — internal isolation
  // ------------------------------------------------------------------
  it("getRequests() does not expose the internal array", async () => {
    const service = new MockAIService();

    await service.generate(sampleRequest());

    const first = service.getRequests();
    const second = service.getRequests();

    // They should be different array instances
    expect(first).not.toBe(second);
    // But have equivalent content
    expect(first).toEqual(second);
  });

  it("stored request history is protected from mutation of the original request", async () => {
    const service = new MockAIService();

    const messages = [{ role: "user" as const, content: "Original" }];
    const request: GenerateAIRequest = { messages };

    await service.generate(request);

    // Mutate the original request after it was recorded
    request.messages.push({ role: "assistant", content: "Injected" });
    // Also mutate an existing message
    messages[0] = { role: "user", content: "Mutated" };

    const history = service.getRequests();
    expect(history).toHaveLength(1);
    expect(history[0].messages).toHaveLength(1);
    expect(history[0].messages[0].content).toBe("Original");
    expect(history[0].messages[0].role).toBe("user");
  });

  it("stored request history is protected from mutation of original messages", async () => {
    const service = new MockAIService();

    const msg: AIMessage = { role: "user", content: "Original" };
    const request: GenerateAIRequest = { messages: [msg] };

    await service.generate(request);

    // Mutate the original message object
    msg.content = "Mutated";
    msg.role = "assistant";

    const history = service.getRequests();
    expect(history[0].messages[0].content).toBe("Original");
    expect(history[0].messages[0].role).toBe("user");
  });

  it("mutating objects returned by getRequests() does not mutate internal history", async () => {
    const service = new MockAIService();

    await service.generate(sampleRequest({ messages: [{ role: "user", content: "Safe" }] }));

    // Mutate the returned copy
    const history = service.getRequests();
    history.push({ messages: [{ role: "assistant", content: "Injected" }] });
    history[0].messages[0].content = "Hacked";

    // Internal history must be unchanged
    const fresh = service.getRequests();
    expect(fresh).toHaveLength(1);
    expect(fresh[0].messages[0].content).toBe("Safe");
    expect(fresh[0].messages[0].role).toBe("user");
  });
});
