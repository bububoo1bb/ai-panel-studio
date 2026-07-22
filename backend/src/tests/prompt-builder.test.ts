import { describe, it, expect } from "vitest";
import {
  buildPanelistSystemPrompt,
  buildPanelistMessages,
} from "../ai/PromptBuilder.js";
import { Discussion } from "../domain/discussion.js";
import { Message } from "../domain/message.js";
import { Panelist } from "../domain/panelist.js";

// ------------------------------------------------------------------
// Plain domain fixtures
// ------------------------------------------------------------------

function sampleDiscussion(overrides: Partial<Discussion> = {}): Discussion {
  return {
    id: "disc-1",
    title: "The future of renewable energy",
    status: "active",
    createdAt: "2026-07-22T00:00:00.000Z",
    ...overrides,
  };
}

function samplePanelist(overrides: Partial<Panelist> = {}): Panelist {
  return {
    id: "panelist-1",
    discussionId: "disc-1",
    role: "expert",
    name: "Dr. Li Wei",
    occupation: "Energy Economist",
    title: "Chief Economist at GreenFuture Institute",
    stance: "Market-based carbon pricing is the most efficient path to net-zero",
    color: "#4A90D9",
    status: "waiting",
    currentFocus: null,
    publicSummary: null,
    createdAt: "2026-07-22T00:00:00.000Z",
    ...overrides,
  };
}

function sampleMessages(): Message[] {
  return [
    {
      id: "msg-1",
      discussionId: "disc-1",
      panelistId: null,
      role: "user",
      kind: null,
      content: "What are the main challenges in transitioning to renewable energy?",
      replyToMessageId: null,
      createdAt: "2026-07-22T00:00:01.000Z",
    },
    {
      id: "msg-2",
      discussionId: "disc-1",
      panelistId: null,
      role: "assistant",
      kind: null,
      content: "The primary challenges include grid infrastructure costs and energy storage limitations.",
      replyToMessageId: null,
      createdAt: "2026-07-22T00:00:02.000Z",
    },
    {
      id: "msg-3",
      discussionId: "disc-1",
      panelistId: null,
      role: "user",
      kind: null,
      content: "How does carbon pricing address these issues?",
      replyToMessageId: null,
      createdAt: "2026-07-22T00:00:03.000Z",
    },
  ];
}

// ------------------------------------------------------------------
// buildPanelistSystemPrompt
// ------------------------------------------------------------------
describe("buildPanelistSystemPrompt", () => {
  it("includes the panelist name", () => {
    const prompt = buildPanelistSystemPrompt(samplePanelist({ name: "Dr. Li Wei" }));
    expect(prompt).toContain("Dr. Li Wei");
  });

  it("includes the panelist role", () => {
    const expert = buildPanelistSystemPrompt(samplePanelist({ role: "expert" }));
    expect(expert).toContain("panel expert");

    const host = buildPanelistSystemPrompt(samplePanelist({ role: "host" }));
    expect(host).toContain("moderator");
  });

  it("includes the panelist occupation", () => {
    const prompt = buildPanelistSystemPrompt(
      samplePanelist({ occupation: "Energy Economist" }),
    );
    expect(prompt).toContain("Energy Economist");
  });

  it("includes the panelist title", () => {
    const prompt = buildPanelistSystemPrompt(
      samplePanelist({ title: "Chief Economist at GreenFuture Institute" }),
    );
    expect(prompt).toContain("Chief Economist at GreenFuture Institute");
  });

  it("includes the panelist stance", () => {
    const prompt = buildPanelistSystemPrompt(
      samplePanelist({
        stance: "Market-based carbon pricing is the most efficient path to net-zero",
      }),
    );
    expect(prompt).toContain("Market-based carbon pricing is the most efficient path to net-zero");
  });

  it("instructs the model to output only a public response", () => {
    const prompt = buildPanelistSystemPrompt(samplePanelist());
    expect(prompt).toContain("Output only your public response");
  });

  it("prohibits private chain-of-thought disclosure", () => {
    const prompt = buildPanelistSystemPrompt(samplePanelist());
    expect(prompt).toContain("never reveal private chain-of-thought");
    expect(prompt).toContain("hidden reasoning");
    expect(prompt).toContain("internal analysis");
  });
});

// ------------------------------------------------------------------
// buildPanelistMessages
// ------------------------------------------------------------------
describe("buildPanelistMessages", () => {
  it("begins with one system message", () => {
    const messages = buildPanelistMessages({
      discussion: sampleDiscussion(),
      panelist: samplePanelist(),
      messages: [],
    });

    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("Dr. Li Wei");
  });

  it("includes the real discussion topic", () => {
    const messages = buildPanelistMessages({
      discussion: sampleDiscussion({ title: "The future of renewable energy" }),
      panelist: samplePanelist(),
      messages: [],
    });

    const topicMessage = messages.find((m) => m.role === "user");
    expect(topicMessage).toBeDefined();
    expect(topicMessage!.content).toContain("Discussion topic:");
    expect(topicMessage!.content).toContain("The future of renewable energy");
  });

  it("maps user domain messages to AI user messages", () => {
    const domainMessages: Message[] = [
      {
        id: "msg-1",
        discussionId: "disc-1",
        panelistId: null,
        role: "user",
        kind: null,
        content: "A question",
        replyToMessageId: null,
        createdAt: "2026-07-22T00:00:00.000Z",
      },
    ];

    const result = buildPanelistMessages({
      discussion: sampleDiscussion(),
      panelist: samplePanelist(),
      messages: domainMessages,
    });

    // The first user message is the topic; the second is the conversation message
    const userMessages = result.filter((m) => m.role === "user");
    expect(userMessages).toHaveLength(2);
    expect(userMessages[1].content).toBe("A question");
  });

  it("maps assistant domain messages to AI assistant messages", () => {
    const domainMessages: Message[] = [
      {
        id: "msg-1",
        discussionId: "disc-1",
        panelistId: null,
        role: "assistant",
        kind: null,
        content: "An answer",
        replyToMessageId: null,
        createdAt: "2026-07-22T00:00:00.000Z",
      },
    ];

    const result = buildPanelistMessages({
      discussion: sampleDiscussion(),
      panelist: samplePanelist(),
      messages: domainMessages,
    });

    const assistantMessages = result.filter((m) => m.role === "assistant");
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0].content).toBe("An answer");
  });

  it("preserves message order", () => {
    const all = sampleMessages();
    const result = buildPanelistMessages({
      discussion: sampleDiscussion(),
      panelist: samplePanelist(),
      messages: all,
    });

    // Extract conversation messages (skip system + topic)
    const conversationMessages = result.slice(2);
    expect(conversationMessages).toHaveLength(3);
    expect(conversationMessages[0].role).toBe("user");
    expect(conversationMessages[1].role).toBe("assistant");
    expect(conversationMessages[2].role).toBe("user");
  });

  it("preserves message content exactly", () => {
    const all = sampleMessages();
    const result = buildPanelistMessages({
      discussion: sampleDiscussion(),
      panelist: samplePanelist(),
      messages: all,
    });

    const conversationMessages = result.slice(2);
    expect(conversationMessages[0].content).toBe(
      "What are the main challenges in transitioning to renewable energy?",
    );
    expect(conversationMessages[1].content).toBe(
      "The primary challenges include grid infrastructure costs and energy storage limitations.",
    );
    expect(conversationMessages[2].content).toBe(
      "How does carbon pricing address these issues?",
    );
  });

  it("excludes ids and timestamps from AI messages", () => {
    const all = sampleMessages();
    const result = buildPanelistMessages({
      discussion: sampleDiscussion(),
      panelist: samplePanelist(),
      messages: all,
    });

    for (const msg of result) {
      expect(msg).not.toHaveProperty("id");
      expect(msg).not.toHaveProperty("discussionId");
      expect(msg).not.toHaveProperty("createdAt");
    }
  });

  it("does not mutate the source messages array", () => {
    const original = sampleMessages();
    const copy = JSON.parse(JSON.stringify(original));

    buildPanelistMessages({
      discussion: sampleDiscussion(),
      panelist: samplePanelist(),
      messages: original,
    });

    // The original array and its objects must be unchanged
    expect(original).toEqual(copy);
  });

  it("is deterministic for identical input", () => {
    const input = {
      discussion: sampleDiscussion(),
      panelist: samplePanelist(),
      messages: sampleMessages(),
    };

    const first = buildPanelistMessages(input);
    const second = buildPanelistMessages(input);

    expect(first).toEqual(second);
  });
});
