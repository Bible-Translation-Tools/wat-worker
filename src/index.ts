import {
  WorkflowEntrypoint,
  WorkflowEvent,
  WorkflowStep,
} from "cloudflare:workers";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { jsonl } from "js-jsonl";
import { v4 as uuid4 } from "uuid";

type WordsParams = {
  batchId: string;
  words: WordRequest[];
};

type WordRequest = {
  id: string;
  prompt: string;
  models: any[];
};

type BatchRequest = {
  batchId: string;
  request: WordRequest;
};

type Batch = {
  id: string;
  details: BatchDetails;
};

type BatchProgress = {
  completed: number;
  failed: number;
  total: number;
};

type BatchDetails = {
  status: string;
  error: string | null;
  progress: BatchProgress;
  output: WordResponse[] | null;
};

type WordResponse = {
  id: string;
  results: ModelResponse[] | null;
};

type ModelResponse = {
  model: string;
  result: string;
};

enum BatchStatus {
  QUEUED = "queued",
  RUNNING = "running",
  COMPLETE = "complete",
}

const app = new Hono<{ Bindings: CloudflareBindings }>();

export class WatWorkflow extends WorkflowEntrypoint<
  CloudflareBindings,
  WordsParams
> {
  async run(event: WorkflowEvent<WordsParams>, step: WorkflowStep) {
    await step.do("sending words to the queue", async () => {
      const batchId = event.payload.batchId;
      const words = event.payload.words;

      for (const word of words) {
        await step.do(`sending word: ${word.id}`, async () => {
          // wait a bit before sending message
          await step.sleep("sleep", "1 second");

          const batchRequest: BatchRequest = {
            batchId: batchId,
            request: word,
          };
          await this.env.WAT_QUEUE.send(batchRequest);
        });
      }

      return true;
    });
  }
}

app.post("/chat", async (c) => {
  const params = await c.req.json();
  const models = params.models || [];
  const prompt = params.prompt || null;

  if (models.length === 0) {
    throw new HTTPException(404, { message: "no models provided" });
  }

  if (prompt == null) {
    throw new HTTPException(404, { message: "empty prompt" });
  }

  try {
    const request = {
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    };

    const batchResult = await Promise.all(
      models.map(async (model: any) => {
        const result = await c.env.AI.run(model, request);
        return {
          model: model,
          result: result.response,
        };
      })
    );

    return c.json(batchResult);
  } catch (error) {
    throw new HTTPException(404, {
      message: `error getting chat response: ${error}`,
    });
  }
});

app.post("/batch", async (c) => {
  const body = await c.req.blob();

  if (body.type !== "application/octet-stream") {
    throw new HTTPException(403, { message: "invalid file" });
  }

  try {
    const batchId = uuid4();

    const text = await new Response(body).text();
    const words = jsonl.parse<WordRequest>(text);

    const progress: BatchProgress = {
      completed: 0,
      failed: 0,
      total: words.length,
    };

    const details: BatchDetails = {
      status: BatchStatus.QUEUED,
      error: null,
      output: null,
      progress: progress,
    };

    const batch: Batch = {
      id: batchId,
      details: details,
    };

    await c.env.BATCHES_BUCKET.put(batchId, JSON.stringify(batch));

    const params: WordsParams = {
      batchId: batchId,
      words: words,
    };
    await c.env.WAT_WORKFLOW.create({ params: params });

    return c.json(batch);
  } catch (error) {
    throw new HTTPException(403, { message: `error creating batch: ${error}` });
  }
});

app.get("/batch/:id", async (c) => {
  try {
    const batchId = c.req.param("id");
    const batchFile = await c.env.BATCHES_BUCKET.get(batchId);
    const text = await new Response(batchFile?.body).text();
    const batch: Batch = JSON.parse(text);
    return c.json(batch);
  } catch (error) {
    throw new HTTPException(403, { message: `error fetching batch: ${error}` });
  }
});

export default {
  fetch: app.fetch,
  async queue(
    batch: MessageBatch<BatchRequest>,
    env: CloudflareBindings,
    ctx: ExecutionContext
  ) {
    for (const message of batch.messages) {
      try {
        const batchId = message.body.batchId;
        const word = message.body.request;

        const modelResults: ModelResponse[] = [];

        for (const model of word.models) {
          const request = {
            messages: [
              {
                role: "user",
                content: word.prompt,
              },
            ],
          };
          const result = await env.AI.run(model, request);

          const output: ModelResponse = {
            model: model,
            result: result.response,
          };
          modelResults.push(output);
        }

        const wordResult: WordResponse = {
          id: word.id,
          results: modelResults,
        };

        const batchFile = await env.BATCHES_BUCKET.get(batchId);
        const text = await new Response(batchFile?.body).text();
        const batch: Batch = JSON.parse(text);

        let progress = batch.details.progress;
        let output = batch.details.output;
        if (output === null) {
          output = [];
        }

        output.push(wordResult);

        progress.completed++;

        if (progress.completed + progress.failed === progress.total) {
          batch.details.status = BatchStatus.COMPLETE;
        } else {
          batch.details.status = BatchStatus.RUNNING;
        }

        batch.details.output = output;
        batch.details.progress = progress;

        await env.BATCHES_BUCKET.put(batchId, JSON.stringify(batch));
        message.ack();
      } catch (error) {
        console.error(error);
        message.retry({ delaySeconds: 5 });
      }
    }
  },
};
