---
title: Fast mode
url: https://platform.claude.com/docs/en/build-with-claude/fast-mode
description: Get up to 2.5x higher output tokens per second from supported Claude models.
featureMetadata:
  betaHeader: fast-mode-2026-02-01
  zdr:
    eligibility: eligible
    note: Excludes [Covered Models](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention#model-specific-data-retention-requirements). Same Messages API endpoint with faster inference. ZDR applies regardless of speed setting.
  supportedModels:
    - claude-fable-5-2
    - claude-mythos-5-2
    - claude-opus-5-5
    - claude-opus-5
    - claude-opus-4-8
  supportedPlatforms:
    Claude API: stable
    Claude Models on Google Cloud (Anthropic managed): stable
    Claude Models on Google Cloud (Google managed): stable
    Microsoft Foundry:
      availability: stable
      note: On Microsoft Foundry, fast mode is a separate model whose ID ends in `-fast`. Send requests to a deployment of that model, and leave out `speed`.
  details:
    - Fast mode on Claude Opus 5 and Claude Opus 4.8 is in research preview and needs the `fast-mode-2026-02-01` beta header.
---

**API support**: Usage differs by product.

* **Messages API**: Set `speed: "fast"` on the request.
* **Managed Agents**: Set `speed` on the agent’s model object, for example `{"id": "claude-opus-5-5", "speed": "fast"}`.

Fast mode delivers up to 2.5x higher output tokens per second at premium pricing. Set `speed: "fast"` on your request to opt in. Fast mode is available on Claude Fable 5.2 and Claude Opus 5.5. Fast mode for Claude Opus 5 and Claude Opus 4.8 is in research preview. Claude Mythos 5.2 supports fast mode too.

## How fast mode works

Fast mode runs the same model with a faster inference configuration. There is no change to intelligence or capabilities.

* Up to 2.5x higher output tokens per second compared to standard speed
* Speed benefits are focused on output tokens per second (OTPS), not time to first token (TTFT)
* Compatible with [streaming](https://platform.claude.com/docs/en/build-with-claude/streaming), where the OTPS gain is most visible

## Basic usage

Fast mode works only on supported models. See [Availability](https://platform.claude.com/docs/en/build-with-claude/fast-mode#feature-availability) for details, including which models need a beta header.

On [Claude in Microsoft Foundry](https://platform.claude.com/docs/en/build-with-claude/claude-in-microsoft-foundry), fast mode is a separate model, such as `claude-opus-5-5-fast`. For Claude Fable 5.2, it is `claude-fable-5-2-fast`. For Claude Mythos 5.2, it is `claude-mythos-5-2-fast`. Send fast mode requests to a deployment of the fast model, and leave out `speed`. A request that sets `speed` on a deployment of the model without `-fast` returns an error.

<CodeGroup>
  ```bash cURL
  curl https://api.anthropic.com/v1/messages \
    -H "x-api-key: $ANTHROPIC_API_KEY" \
    -H "anthropic-version: 2026-10-21" \
    -H "content-type: application/json" \
    -d '{
      "model": "claude-opus-5-5",
      "max_tokens": 4096,
      "speed": "fast",
      "messages": [{
        "role": "user",
        "content": "Refactor this module to use dependency injection"
      }]
    }'
  ```

  ```bash CLI
  ant messages create <<'YAML'
  model: claude-opus-5-5
  max_tokens: 4096
  speed: fast
  messages:
    - role: user
      content: Refactor this module to use dependency injection
  YAML
  ```

  ```python Python
  client = anthropic.Anthropic()

  response = client.messages.create(
      model="claude-opus-5-5",
      max_tokens=4096,
      speed="fast",
      messages=[
          {"role": "user", "content": "Refactor this module to use dependency injection"}
      ],
  )

  for block in response.content:
      if block.type == "text":
          print(block.text)
  ```

  ```typescript TypeScript
  const client = new Anthropic();

  const response = await client.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 4096,
    speed: "fast",
    messages: [
      {
        role: "user",
        content: "Refactor this module to use dependency injection"
      }
    ]
  });

  const textBlock = response.content.find((block) => block.type === "text");
  console.log(textBlock?.text);
  ```

  ```csharp C#
  AnthropicClient client = new();

  var response = await client.Messages.Create(new MessageCreateParams
  {
      Model = Model.ClaudeOpus5_5,
      MaxTokens = 4096,
      Speed = Speed.Fast,
      Messages = [
          new UserMessageParam { Content = "Refactor this module to use dependency injection" }
      ],
  });

  foreach (var block in response.Content)
  {
      if (block.TryPickText(out var textBlock))
      {
          Console.WriteLine(textBlock.Text);
      }
  }
  ```

  ```go Go
  client := anthropic.NewClient()

  response, err := client.Messages.New(context.TODO(), anthropic.MessageNewParams{
  	Model:     anthropic.ModelClaudeOpus5_5,
  	MaxTokens: 4096,
  	Speed:     anthropic.MessageNewParamsSpeedFast,
  	Messages: []anthropic.MessageParam{
  		anthropic.NewUserMessage(anthropic.NewTextBlock("Refactor this module to use dependency injection")),
  	},
  })
  if err != nil {
  	log.Fatal(err)
  }
  for _, block := range response.Content {
  	if textBlock, ok := block.AsAny().(anthropic.TextBlock); ok {
  		fmt.Println(textBlock.Text)
  	}
  }
  ```

  ```java Java
  AnthropicClient client = AnthropicOkHttpClient.fromEnv();

  Message response = client.messages().create(
      MessageCreateParams.builder()
          .model(Model.CLAUDE_OPUS_5_5)
          .maxTokens(4096L)
          .speed(MessageCreateParams.Speed.FAST)
          .addUserMessage("Refactor this module to use dependency injection")
          .build());

  response.content().stream()
      .flatMap(block -> block.text().stream())
      .forEach(textBlock -> IO.println(textBlock.text()));
  ```

  ```php PHP
  $client = new Client();

  $response = $client->messages->create(
      model: Model::CLAUDE_OPUS_5_5,
      maxTokens: 4096,
      speed: 'fast',
      messages: [
          ['role' => 'user', 'content' => 'Refactor this module to use dependency injection'],
      ],
  );

  foreach ($response->content as $block) {
      if ($block instanceof \Anthropic\Messages\TextBlock) {
          echo $block->text, PHP_EOL;
      }
  }
  ```

  ```ruby Ruby
  client = Anthropic::Client.new

  response = client.messages.create(
    model: Anthropic::Model::CLAUDE_OPUS_5_5,
    max_tokens: 4096,
    speed: "fast",
    messages: [{ role: "user", content: "Refactor this module to use dependency injection" }]
  )

  response.content.each do |block|
    puts block.text if block.is_a?(Anthropic::Models::TextBlock)
  end
  ```
</CodeGroup>

## Rate limits

Fast mode has a dedicated rate limit that is separate from standard rate limits. When you exceed your fast mode rate limit, the API returns a `429` error with a `retry-after` header that says when capacity is available. On [Claude Models on Google Cloud (Google managed)](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/google-managed#rate-limits), Google Cloud manages rate limits and quotas.

Claude Opus 5.5 has a default fast mode rate limit in the Start, Build, and Scale [usage tiers](https://platform.claude.com/docs/en/api/rate-limits), so you don’t need to request access to use fast mode with it. Organizations in the Evaluation tier can use fast mode with Claude Opus 5.5 once they move to the Start, Build, or Scale tier. The same applies to Claude Fable 5.2. It also applies to Claude Mythos 5.2.

The response includes headers that indicate your fast mode rate limit status:

| Header                                   | Description                                       |
| ---------------------------------------- | ------------------------------------------------- |
| `anthropic-fast-input-tokens-limit`      | Maximum fast mode input tokens per minute         |
| `anthropic-fast-input-tokens-remaining`  | Remaining fast mode input tokens                  |
| `anthropic-fast-input-tokens-reset`      | Time when the fast mode input token limit resets  |
| `anthropic-fast-output-tokens-limit`     | Maximum fast mode output tokens per minute        |
| `anthropic-fast-output-tokens-remaining` | Remaining fast mode output tokens                 |
| `anthropic-fast-output-tokens-reset`     | Time when the fast mode output token limit resets |

To see your fast mode rate limits, go to the [Rate limits](https://platform.claude.com/usage/limits) page in the Claude Console.

## Checking which speed was used

The response `usage` object includes a `speed` field that indicates which speed was used, either `"fast"` or `"standard"`. Requesting `speed: "fast"` on a [model that doesn’t support fast mode](https://platform.claude.com/docs/en/build-with-claude/fast-mode#feature-availability) returns an error, and so does exceeding fast mode’s rate limits or capacity (a `429` or `529`). When a request with `speed: "fast"` succeeds, `usage.speed` is `"fast"`. Claude Opus 4.6 is an exception: instead of returning an error, a request with `speed: "fast"` and the `fast-mode-2026-02-01` beta header succeeds, but runs at standard speed. In this situation, `usage.speed` shows `"standard"`. On Claude Models on Google Cloud (Anthropic managed), a Claude Opus 4.6 request with `speed: "fast"` returns a `400` error even with the header.

<CodeGroup>
  ```bash cURL
  curl https://api.anthropic.com/v1/messages \
    -H "x-api-key: $ANTHROPIC_API_KEY" \
    -H "anthropic-version: 2026-10-21" \
    -H "content-type: application/json" \
    -d '{
      "model": "claude-opus-5-5",
      "max_tokens": 1024,
      "speed": "fast",
      "messages": [{"role": "user", "content": "Hello"}]
    }'
  ```

  ```bash CLI
  ant messages create <<'YAML'
  model: claude-opus-5-5
  max_tokens: 1024
  speed: fast
  messages:
    - role: user
      content: Hello
  YAML
  ```

  ```python Python
  client = anthropic.Anthropic()

  response = client.messages.create(
      model="claude-opus-5-5",
      max_tokens=1024,
      speed="fast",
      messages=[{"role": "user", "content": "Hello"}],
  )

  print(response.usage.speed)  # "fast" or "standard"
  ```

  ```typescript TypeScript
  const client = new Anthropic();

  const response = await client.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 1024,
    speed: "fast",
    messages: [{ role: "user", content: "Hello" }]
  });

  console.log(response.usage.speed); // "fast" or "standard"
  ```

  ```csharp C#
  AnthropicClient client = new();

  var response = await client.Messages.Create(new MessageCreateParams
  {
      Model = Model.ClaudeOpus5_5,
      MaxTokens = 1024,
      Speed = Speed.Fast,
      Messages = [new UserMessageParam { Content = "Hello" }],
  });

  Console.WriteLine(response.Usage.Speed);  // "fast" or "standard"
  ```

  ```go Go
  client := anthropic.NewClient()

  response, err := client.Messages.New(context.TODO(), anthropic.MessageNewParams{
  	Model:     anthropic.ModelClaudeOpus5_5,
  	MaxTokens: 1024,
  	Speed:     anthropic.MessageNewParamsSpeedFast,
  	Messages: []anthropic.MessageParam{
  		anthropic.NewUserMessage(anthropic.NewTextBlock("Hello")),
  	},
  })
  if err != nil {
  	log.Fatal(err)
  }
  fmt.Println(response.Usage.Speed) // "fast" or "standard"
  ```

  ```java Java
  AnthropicClient client = AnthropicOkHttpClient.fromEnv();

  MessageCreateParams params = MessageCreateParams.builder()
      .model(Model.CLAUDE_OPUS_5_5)
      .maxTokens(1024L)
      .speed(MessageCreateParams.Speed.FAST)
      .addUserMessage("Hello")
      .build();

  Message response = client.messages().create(params);
  IO.println(response.usage().speed().orElseThrow());  // "fast" or "standard"
  ```

  ```php PHP
  $client = new Client();

  $response = $client->messages->create(
      model: Model::CLAUDE_OPUS_5_5,
      maxTokens: 1024,
      speed: 'fast',
      messages: [['role' => 'user', 'content' => 'Hello']],
  );

  echo $response->usage->speed;  // "fast" or "standard"
  ```

  ```ruby Ruby
  client = Anthropic::Client.new

  response = client.messages.create(
    model: Anthropic::Model::CLAUDE_OPUS_5_5,
    max_tokens: 1024,
    speed: "fast",
    messages: [{ role: "user", content: "Hello" }]
  )

  puts(response.usage.speed)  # "fast" or "standard"
  ```
</CodeGroup>

```json Output
{
  "id": "msg_01XFDUDYJgAACzvnptvVoYEL",
  "type": "message",
  "role": "assistant",
// ...
  "usage": {
    "input_tokens": 8,
    "output_tokens": 12,
    "speed": "fast"
  }
}
```

To track fast mode usage and costs across your organization, see the [Usage and Cost Analytics API](https://platform.claude.com/docs/en/manage-claude/usage-cost-analytics-api).

## Retries and fallbacks

### Automatic retries

The SDK automatically retries fast mode `429` errors up to two times by default (configurable with `max_retries` (typescript, php: `maxRetries`; java: `.maxRetries()`; csharp: `MaxRetries`; go: `option.WithMaxRetries()`)), waiting for the delay in the `retry-after` header before each retry. Because fast mode uses continuous token replenishment, the `retry-after` delay is typically short and requests succeed once capacity is available.

### Falling back to standard speed

If you’d prefer to fall back to standard speed rather than wait for fast mode capacity, catch the rate limit error and retry without `speed: "fast"`. On Claude in Microsoft Foundry, the deployment sets the speed, so retry on a deployment of the model without `-fast` instead. Set `max_retries` (typescript, php: `maxRetries`; java: `.maxRetries()`; csharp: `MaxRetries`; go: `option.WithMaxRetries()`) to `0` on the initial fast request to skip automatic retries and fail immediately on rate limit errors.

<Note>
  Falling back from fast to standard speed results in a [prompt cache](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) miss. Requests at different speeds do not share cached prefixes.
</Note>

Because setting `max_retries` (typescript, php: `maxRetries`; java: `.maxRetries()`; csharp: `MaxRetries`; go: `option.WithMaxRetries()`) to `0` also disables retries for other transient errors (overloaded, internal server errors), the following examples resend the request after those errors.

<CodeGroup exclude="shell:cURL, shell:CLI">
  ```python Python
  client = anthropic.Anthropic()


  def create_message_with_fast_fallback(max_retries=0, max_attempts=3, **params):
      try:
          return client.with_options(max_retries=max_retries).messages.create(**params)
      except anthropic.RateLimitError:
          if params.get("speed") == "fast":
              del params["speed"]
              return create_message_with_fast_fallback(max_retries=max_retries, **params)
          raise
      except (
          anthropic.APIStatusError,
          anthropic.APIConnectionError,
      ) as error:
          if isinstance(error, anthropic.APIStatusError) and error.status_code < 500:
              raise
          if max_attempts > 1:
              return create_message_with_fast_fallback(
                  max_retries=max_retries, max_attempts=max_attempts - 1, **params
              )
          raise


  message = create_message_with_fast_fallback(
      model="claude-opus-5-5",
      max_tokens=1024,
      messages=[{"role": "user", "content": "Hello"}],
      speed="fast",
      max_retries=0,
  )
  ```

  ```typescript TypeScript
  const client = new Anthropic();

  async function createMessageWithFastFallback(
    params: Anthropic.MessageCreateParamsNonStreaming,
    requestOptions?: Anthropic.RequestOptions,
    maxAttempts: number = 3
  ): Promise<Anthropic.Message> {
    try {
      return await client.messages.create(params, requestOptions);
    } catch (e) {
      if (e instanceof Anthropic.RateLimitError && params.speed === "fast") {
        const { speed, ...rest } = params;
        return createMessageWithFastFallback(rest);
      }
      if (
        e instanceof Anthropic.InternalServerError ||
        e instanceof Anthropic.APIConnectionError
      ) {
        if (maxAttempts > 1) {
          return createMessageWithFastFallback(params, undefined, maxAttempts - 1);
        }
      }
      throw e;
    }
  }

  const message = await createMessageWithFastFallback(
    {
      model: "claude-opus-5-5",
      max_tokens: 1024,
      messages: [{ role: "user", content: "Hello" }],
      speed: "fast"
    },
    { maxRetries: 0 }
  );
  ```

  ```csharp C#
  AnthropicClient client = new();

  async Task<Message> CreateMessageWithFastFallback(
      MessageCreateParams parameters,
      int? maxRetries = null,
      int maxAttempts = 3)
  {
      try
      {
          var requestClient = maxRetries is int retries
              ? client.WithOptions(options => options with { MaxRetries = retries })
              : client;
          return await requestClient.Messages.Create(parameters);
      }
      catch (AnthropicRateLimitException)
      {
          if (parameters.Speed is not null)
          {
              return await CreateMessageWithFastFallback(
                  parameters with { Speed = null });
          }
          throw;
      }
      catch (Anthropic5xxException)
      {
          if (maxAttempts > 1)
          {
              return await CreateMessageWithFastFallback(
                  parameters, maxAttempts: maxAttempts - 1);
          }
          throw;
      }
  }

  var message = await CreateMessageWithFastFallback(
      new MessageCreateParams
      {
          Model = Model.ClaudeOpus5_5,
          MaxTokens = 1024,
          Messages = [new UserMessageParam { Content = "Hello" }],
          Speed = Speed.Fast,
      },
      maxRetries: 0);
  ```

  ```go Go
  func createMessageWithFastFallback(
  	ctx context.Context,
  	client *anthropic.Client,
  	params anthropic.MessageNewParams,
  	maxAttempts int,
  	opts ...option.RequestOption,
  ) (*anthropic.Message, error) {
  	message, err := client.Messages.New(ctx, params, opts...)
  	if err != nil {
  		var apierr *anthropic.Error
  		if errors.As(err, &apierr) && apierr.StatusCode == 429 && params.Speed != "" {
  			params.Speed = ""
  			return createMessageWithFastFallback(ctx, client, params, maxAttempts)
  		}
  		if (errors.As(err, &apierr) && apierr.StatusCode >= 500) || !errors.As(err, &apierr) {
  			if maxAttempts > 1 {
  				return createMessageWithFastFallback(ctx, client, params, maxAttempts-1)
  			}
  		}
  		return nil, err
  	}
  	return message, nil
  }

  func main() {
  	client := anthropic.NewClient()
  	message, err := createMessageWithFastFallback(
  		context.TODO(),
  		&client,
  		anthropic.MessageNewParams{
  			Model:     anthropic.ModelClaudeOpus5_5,
  			MaxTokens: 1024,
  			Messages: []anthropic.MessageParam{
  				anthropic.NewUserMessage(anthropic.NewTextBlock("Hello")),
  			},
  			Speed: anthropic.MessageNewParamsSpeedFast,
  		},
  		3,
  		option.WithMaxRetries(0),
  	)
  	if err != nil {
  		panic(err)
  	}
  	fmt.Println(message)
  }
  ```

  ```java Java
  import com.anthropic.errors.InternalServerException;
  import com.anthropic.errors.RateLimitException;
  // ...
  // Disable SDK auto-retry so the fallback logic that follows handles it
  AnthropicClient client =
      AnthropicOkHttpClient.builder()
          .fromEnv()
          .maxRetries(0)
          .build();

  Message createMessageWithFastFallback(
          MessageCreateParams params, int maxAttempts) {
      try {
          return client.messages().create(params);
      } catch (RateLimitException e) {
          if (params.speed().isPresent()) {
              MessageCreateParams retryParams = params.toBuilder()
                  .speed(Optional.empty())
                  .build();
              return createMessageWithFastFallback(retryParams, maxAttempts);
          }
          throw e;
      } catch (InternalServerException e) {
          if (maxAttempts > 1) {
              return createMessageWithFastFallback(params, maxAttempts - 1);
          }
          throw e;
      }
  }

  void main() {
      Message message = createMessageWithFastFallback(
          MessageCreateParams.builder()
              .model(Model.CLAUDE_OPUS_5_5)
              .maxTokens(1024L)
              .addUserMessage("Hello")
              .speed(MessageCreateParams.Speed.FAST)
              .build(),
          3);
      message.content().stream()
          .flatMap(block -> block.text().stream())
          .forEach(textBlock -> IO.println(textBlock.text()));
  }
  ```

  ```php PHP
  use Anthropic\Core\Exceptions\APIConnectionException;
  use Anthropic\Core\Exceptions\InternalServerException;
  use Anthropic\Core\Exceptions\RateLimitException;
  use Anthropic\Messages\Model;
  use Anthropic\RequestOptions;
  // ...
  $client = new Client();

  function createMessageWithFastFallback(
      Client $client,
      array $params,
      ?RequestOptions $requestOptions = null,
      int $maxAttempts = 3,
  ) {
      try {
          return $client->messages->create(
              ...$params,
              requestOptions: $requestOptions,
          );
      } catch (RateLimitException $e) {
          if (isset($params['speed'])) {
              unset($params['speed']);
              return createMessageWithFastFallback($client, $params);
          }
          throw $e;
      } catch (InternalServerException | APIConnectionException $e) {
          if ($maxAttempts > 1) {
              return createMessageWithFastFallback(
                  $client, $params, maxAttempts: $maxAttempts - 1
              );
          }
          throw $e;
      }
  }

  $message = createMessageWithFastFallback(
      $client,
      [
          'model' => Model::CLAUDE_OPUS_5_5,
          'maxTokens' => 1024,
          'messages' => [['role' => 'user', 'content' => 'Hello']],
          'speed' => 'fast',
      ],
      RequestOptions::with(maxRetries: 0),
  );
  ```

  ```ruby Ruby
  client = Anthropic::Client.new

  def create_message_with_fast_fallback(client, request_options: {}, max_attempts: 3, **params)
    client.messages.create(**params, request_options: request_options)
  rescue Anthropic::Errors::RateLimitError
    raise unless params[:speed] == "fast"
    params.delete(:speed)
    create_message_with_fast_fallback(client, **params)
  rescue Anthropic::Errors::InternalServerError, Anthropic::Errors::APIConnectionError
    raise unless max_attempts > 1
    create_message_with_fast_fallback(client, max_attempts: max_attempts - 1, **params)
  end

  message = create_message_with_fast_fallback(
    client,
    model: Anthropic::Model::CLAUDE_OPUS_5_5,
    max_tokens: 1024,
    messages: [{ role: "user", content: "Hello" }],
    speed: "fast",
    request_options: { max_retries: 0 }
  )
  ```
</CodeGroup>

## Considerations

* **Batch API:** Fast mode is not available with the [Batch API](https://platform.claude.com/docs/en/build-with-claude/batch-processing).
* **Priority Tier:** Fast mode is not available with a [Priority Tier](https://platform.claude.com/docs/en/api/service-tiers) commitment.

## Pricing

Fast mode is priced at a multiplier on standard rates across the full context window, including requests over 200k input tokens. On Claude Models on Google Cloud (Google managed), Google Cloud sets fast mode prices. See [Cloud platform pricing](https://platform.claude.com/docs/en/about-claude/pricing#cloud-platform-pricing).

| Model                           | Input          | Output         |
| ------------------------------- | -------------- | -------------- |
| Claude Fable 5.2                | $16 USD / MTok | $80 USD / MTok |
| Claude Mythos 5.2               | $16 USD / MTok | $80 USD / MTok |
| Claude Opus 5.5                 | $8 USD / MTok  | $40 USD / MTok |
| Claude Opus 5 / Claude Opus 4.8 | $10 USD / MTok | $50 USD / MTok |

Fast mode pricing stacks with other pricing modifiers:

* [Prompt caching multipliers](https://platform.claude.com/docs/en/about-claude/pricing#prompt-caching) apply on top of fast mode pricing.
* [Data residency](https://platform.claude.com/docs/en/manage-claude/data-residency) multipliers apply on top of fast mode pricing.

For complete pricing details, see the [Pricing](https://platform.claude.com/docs/en/about-claude/pricing#fast-mode-pricing) page.

## Availability

Fast mode is available or in research preview on select models and eligible for zero data retention and HIPAA readiness.

### API support

Fast mode is available only on the following models. If you were using fast mode on an earlier model, [migrate to a model that supports fast mode](https://platform.claude.com/docs/en/models/opus-5-5/migration-guide).

To access fast mode on Claude Opus 5, contact your account manager or [join the waitlist](https://claude.com/fast-mode).

<Warning>
  Fast mode on Claude Opus 4.8 is deprecated and will be removed on November 30, 2026. After removal, requests to `claude-opus-4-8` with `speed: "fast"` will return an error. To continue using fast mode, migrate to Claude Opus 5.5. See [Migrating to Claude Opus 5.5 from Claude Opus 4.8](https://platform.claude.com/docs/en/models/opus-5-5/migration-guide#migrating-from-claude-opus-4-8).
</Warning>

#### [Messages API](https://platform.claude.com/docs/en/build-with-claude/working-with-messages)

* Availability: Available
* Usage: Set `speed: "fast"` on the request.

| Status                | Cloud platforms                                                                                                                                                                                                                                                                                                              | Models                                                                                                                                                                 |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Available             | Claude API, [Claude Models on Google Cloud (Anthropic managed)](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed), [Claude Models on Google Cloud (Google managed)](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/google-managed) | [Claude Fable 5.2](https://platform.claude.com/docs/en/models/fable-5-2/overview), [Claude Mythos 5.2](https://platform.claude.com/docs/en/models/mythos-5-2/overview) |
| Available<sup>1</sup> | [Microsoft Foundry (hosted on Anthropic)](https://platform.claude.com/docs/en/build-with-claude/claude-in-microsoft-foundry)                                                                                                                                                                                                 | [Claude Fable 5.2](https://platform.claude.com/docs/en/models/fable-5-2/overview), [Claude Mythos 5.2](https://platform.claude.com/docs/en/models/mythos-5-2/overview) |
| Available             | Claude API, [Claude Models on Google Cloud (Anthropic managed)](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed)                                                                                                                                                       | [Claude Opus 5.5](https://platform.claude.com/docs/en/models/opus-5-5/overview)                                                                                        |
| Available<sup>1</sup> | [Microsoft Foundry (hosted on Azure)](https://platform.claude.com/docs/en/build-with-claude/claude-in-microsoft-foundry)                                                                                                                                                                                                     | [Claude Opus 5.5](https://platform.claude.com/docs/en/models/opus-5-5/overview)                                                                                        |
| Research preview      | Claude API                                                                                                                                                                                                                                                                                                                   | [Claude Opus 5](https://platform.claude.com/docs/en/models/opus-5/overview), [Claude Opus 4.8](https://platform.claude.com/docs/en/models/opus-4-8/overview)           |

1. On Microsoft Foundry, fast mode is a separate model whose ID ends in `-fast`. Send requests to a deployment of that model, and leave out `speed`.

#### [Managed Agents](https://platform.claude.com/docs/en/managed-agents/overview)

* Availability: Available
* Usage: Set `speed` on the agent’s model object, for example `{"id": "claude-opus-5-5", "speed": "fast"}`.

| Status           | Cloud platforms | Models                                                                                                                                                       |
| ---------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Available        | Claude API      | [Claude Opus 5.5](https://platform.claude.com/docs/en/models/opus-5-5/overview)                                                                              |
| Research preview | Claude API      | [Claude Opus 5](https://platform.claude.com/docs/en/models/opus-5/overview), [Claude Opus 4.8](https://platform.claude.com/docs/en/models/opus-4-8/overview) |

### Required beta headers

[Beta headers overview](https://platform.claude.com/docs/en/api/beta-headers)

Beta headers allow you to access experimental features and new model capabilities before they become part of the standard API.

| Header                 | Models                                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `fast-mode-2026-02-01` | [Claude Opus 5](https://platform.claude.com/docs/en/models/opus-5/overview), [Claude Opus 4.8](https://platform.claude.com/docs/en/models/opus-4-8/overview) |

### Data handling

[Data handling overview](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention#feature-eligibility)

| Item    | Zero data retention                                                                                                                                       | HIPAA    |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Status  | Eligible (excludes [Covered Models](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention#model-specific-data-retention-requirements)) | Eligible |
| Details | Same Messages API endpoint with faster inference. ZDR applies regardless of speed setting.                                                                | —        |

Applicable endpoints:

* `/v1/messages` with `speed: "fast"`

## Next steps

<CardGroup cols={2}>
  <Card title="Structured outputs" icon="code-brackets" href="https://platform.claude.com/docs/en/build-with-claude/structured-outputs">
    Get validated JSON results from agent workflows.
  </Card>

  <Card title="Pricing" icon="calculator" href="https://platform.claude.com/docs/en/about-claude/pricing#fast-mode-pricing">
    Learn about Anthropic’s pricing structure for models and features.
  </Card>

  <Card title="Effort" icon="gauge" href="https://platform.claude.com/docs/en/build-with-claude/effort">
    Control how many tokens Claude uses when responding with the effort parameter, trading off between response thoroughness and token efficiency.
  </Card>

  <Card title="Streaming messages" icon="arrow-right" href="https://platform.claude.com/docs/en/build-with-claude/streaming">
    Stream Messages API responses incrementally with server-sent events, including text, tool use, and extended thinking deltas.
  </Card>
</CardGroup>
