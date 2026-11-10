---
title: Claude Models on Google Cloud (Google managed)
url: https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/google-managed
description: Google operates Claude Models on Google Cloud (Google managed) as part of Google Cloud's Agent Platform. You can call Claude with Anthropic's client SDKs.
---

[Claude Models on Google Cloud](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/overview) compares the two Google Cloud offerings. It also shows how to tell which one you use.

## Before making API calls

To use Claude Models on Google Cloud (Google managed), you need:

1. A Google Cloud project that can use Agent Platform. For setup steps, see Google Cloud’s [Anthropic Claude models on Agent Platform](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/claude) page.
2. The [gcloud CLI](https://cloud.google.com/sdk/docs/install) installed, for local development.
3. For the identity making the calls, an IAM role that includes the `aiplatform.endpoints.predict` permission, such as Agent Platform User (`roles/aiplatform.user`). For details, see Google Cloud’s [Agent Platform partner models](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/use-partner-models) page.
4. Google Cloud credentials for that identity. To authenticate the SDK with Google Cloud, you might need to run `gcloud auth application-default login`. A cURL request to Claude Models on Google Cloud (Google managed) can get its token from `gcloud auth print-access-token`. That command uses the gcloud CLI’s own login, not Application Default Credentials, so run `gcloud auth login` or `gcloud init` before you use it.

### Install an SDK

The [client SDK](https://platform.claude.com/docs/en/cli-sdks-libraries/overview) supports Claude Models on Google Cloud (Google managed) through `AnthropicVertex` (csharp: `AnthropicVertexClient`; go: `vertex.WithGoogleAuth()`; java: `VertexBackend`; php: `Anthropic\Vertex\Client`; ruby: `Anthropic::VertexClient`). Install the package that provides it:

<Tabs>
  <Tab title="Python">
    ```bash
    pip install -U "anthropic[vertex]"
    ```
  </Tab>

  <Tab title="TypeScript">
    ```bash
    npm install @anthropic-ai/vertex-sdk
    ```
  </Tab>

  <Tab title="C#">
    ```bash
    dotnet add package Anthropic.Vertex
    ```
  </Tab>

  <Tab title="Go">
    ```bash
    go get github.com/anthropics/anthropic-sdk-go/v2
    go get github.com/anthropics/anthropic-sdk-go/v2/vertex
    ```
  </Tab>

  <Tab title="Java">
    <Tabs>
      <Tab title="Gradle">
        ```kotlin
        implementation("com.anthropic:anthropic-java:3.7.0")
        implementation("com.anthropic:anthropic-java-vertex:3.7.0")
        ```
      </Tab>

      <Tab title="Maven">
        ```xml
        <dependency>
            <groupId>com.anthropic</groupId>
            <artifactId>anthropic-java</artifactId>
            <version>3.7.0</version>
        </dependency>
        <dependency>
            <groupId>com.anthropic</groupId>
            <artifactId>anthropic-java-vertex</artifactId>
            <version>3.7.0</version>
        </dependency>
        ```
      </Tab>
    </Tabs>
  </Tab>

  <Tab title="PHP">
    ```bash
    composer require anthropic-ai/sdk google/auth
    ```
  </Tab>

  <Tab title="Ruby">
    ```bash
    # Gemfile
    gem "anthropic"
    gem "googleauth"
    ```
  </Tab>
</Tabs>

The `ant` CLI doesn’t support Claude Models on Google Cloud (Google managed).

## Making requests

Requests to Claude Models on Google Cloud (Google managed) go to an Agent Platform endpoint URL that ends in `:rawPredict`. Streaming requests use `:streamRawPredict` instead.

A request is nearly identical to a [Messages API](https://platform.claude.com/docs/en/api/messages/create) request. It differs in two main ways:

* **Model:** The endpoint URL names the model. In a cURL request, leave `model` out of the body.
* **Version:** In a cURL request, pass `anthropic_version` in the body, not as a header. Set it to `vertex-2023-10-16`, or to [API version `2026-10-21`](https://platform.claude.com/docs/en/api/migration-2026-10-21).

The following examples use the global endpoint. For the other endpoint types, see [Global, multi-region, and regional endpoints](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/google-managed#global-multi-region-and-regional-endpoints).

<CodeGroup exclude="shell:CLI">
  ```bash cURL
  curl https://aiplatform.googleapis.com/v1/projects/MY_PROJECT_ID/locations/global/publishers/anthropic/models/claude-opus-5-5:rawPredict \
    -H "Authorization: Bearer $(gcloud auth print-access-token)" \
    -H "Content-Type: application/json" \
    -d '{
      "anthropic_version": "2026-10-21",
      "messages": [{"role": "user", "content": "Hey Claude!"}],
      "max_tokens": 100
    }'
  ```

  <CodeGroupItem language="CLI">
    The `ant` CLI doesn’t support Claude Models on Google Cloud (Google managed).
  </CodeGroupItem>

  ```python Python
  from anthropic import AnthropicVertex

  project_id = "MY_PROJECT_ID"
  region = "global"

  client = AnthropicVertex(project_id=project_id, region=region)

  message = client.messages.create(
      model="claude-opus-5-5",
      max_tokens=100,
      messages=[
          {
              "role": "user",
              "content": "Hey Claude!",
          }
      ],
  )
  print(message)
  ```

  ```typescript TypeScript
  import { AnthropicVertex } from "@anthropic-ai/vertex-sdk";

  const projectId = "MY_PROJECT_ID";
  const region = "global";

  // Goes through the standard `google-auth-library` flow.
  const client = new AnthropicVertex({
    projectId,
    region
  });

  const result = await client.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 100,
    messages: [
      {
        role: "user",
        content: "Hey Claude!"
      }
    ]
  });
  console.log(JSON.stringify(result, null, 2));
  ```

  ```csharp C#
  using Anthropic.Models.Messages;
  using Anthropic.Vertex;

  var projectId = "MY_PROJECT_ID";
  var region = "global";

  var client = new AnthropicVertexClient(new AnthropicVertexCredentials(region, projectId));

  var parameters = new MessageCreateParams
  {
      Model = Model.ClaudeOpus5_5,
      MaxTokens = 100,
      Messages = [new UserMessageParam { Content = "Hey Claude!" }]
  };

  var message = await client.Messages.Create(parameters);
  Console.WriteLine(message);
  ```

  ```go Go
  import (
  	"context"
  	"fmt"

  	"github.com/anthropics/anthropic-sdk-go/v2"
  	"github.com/anthropics/anthropic-sdk-go/v2/vertex"
  )
  // ...
  	// Uses default Google Cloud credentials
  	client := anthropic.NewClient(
  		vertex.WithGoogleAuth(context.Background(), "global", "MY_PROJECT_ID"),
  	)

  	message, err := client.Messages.New(context.Background(), anthropic.MessageNewParams{
  		Model:     anthropic.ModelClaudeOpus5_5,
  		MaxTokens: 100,
  		Messages: []anthropic.MessageParam{
  			anthropic.NewUserMessage(anthropic.NewTextBlock("Hey Claude!")),
  		},
  	})
  	if err != nil {
  		panic(err)
  	}
  	fmt.Printf("%+v\n", message)
  ```

  ```java Java
  import com.anthropic.client.AnthropicClient;
  import com.anthropic.client.okhttp.AnthropicOkHttpClient;
  import com.anthropic.models.messages.Message;
  import com.anthropic.models.messages.MessageCreateParams;
  import com.anthropic.models.messages.Model;
  import com.anthropic.vertex.backends.VertexBackend;
  import com.google.auth.oauth2.GoogleCredentials;

  void main() throws Exception {
      AnthropicClient client = AnthropicOkHttpClient.builder()
          .backend(
              VertexBackend.builder()
                  .googleCredentials(GoogleCredentials.getApplicationDefault())
                  .region("global")
                  .project("MY_PROJECT_ID")
                  .build()
          )
          .build();

      Message message = client
          .messages()
          .create(
              MessageCreateParams.builder()
                  .model(Model.CLAUDE_OPUS_5_5)
                  .maxTokens(100)
                  .addUserMessage("Hey Claude!")
                  .build()
          );

      IO.println(message);
  }
  ```

  ```php PHP
  use Anthropic\Messages\Model;
  use Anthropic\Messages\TextBlock;
  use Anthropic\Vertex;

  $client = Vertex\Client::fromEnvironment(
      region: 'global',
      projectId: 'MY_PROJECT_ID',
  );

  $message = $client->messages->create(
      maxTokens: 100,
      messages: [
          ['role' => 'user', 'content' => 'Hey Claude!']
      ],
      model: Model::CLAUDE_OPUS_5_5,
  );

  foreach ($message->content as $block) {
      if ($block instanceof TextBlock) {
          echo $block->text . PHP_EOL;
      }
  }
  ```

  ```ruby Ruby
  require "anthropic"

  client = Anthropic::VertexClient.new(
    region: "global",
    project_id: "MY_PROJECT_ID"
  )

  message = client.messages.create(
    model: Anthropic::Model::CLAUDE_OPUS_5_5,
    max_tokens: 100,
    messages: [{ role: "user", content: "Hey Claude!" }]
  )

  puts message.content.find { |block| block.is_a?(Anthropic::Models::TextBlock) }.text
  ```
</CodeGroup>

### API model IDs

| Model                                                                                                 | Agent Platform API model ID  |
| :---------------------------------------------------------------------------------------------------- | :--------------------------- |
| Claude Fable 5.2                                                                                      | `claude-fable-5-2`           |
| Claude Mythos 5.2 ([limited availability](https://support.claude.com/en/articles/14604842))           | `claude-mythos-5-2`          |
| Claude Fable 5.1                                                                                      | `claude-fable-5-1`           |
| Claude Mythos 5.1 ([limited availability](https://support.claude.com/en/articles/14604842))           | `claude-mythos-5-1`          |
| Claude Fable 5                                                                                        | `claude-fable-5`             |
| Claude Mythos 5 ([limited availability](https://support.claude.com/en/articles/14604842))             | `claude-mythos-5`            |
| Claude Opus 5.5                                                                                       | `claude-opus-5-5`            |
| Claude Opus 5                                                                                         | `claude-opus-5`              |
| Claude Opus 4.8                                                                                       | `claude-opus-4-8`            |
| Claude Opus 4.7                                                                                       | `claude-opus-4-7`            |
| Claude Opus 4.6                                                                                       | `claude-opus-4-6`            |
| Claude Opus 4.5                                                                                       | `claude-opus-4-5@20251101`   |
| Claude Opus 4.1 ([deprecated](https://platform.claude.com/docs/en/about-claude/model-deprecations))   | `claude-opus-4-1@20250805`   |
| Claude Opus 4 ([deprecated](https://platform.claude.com/docs/en/about-claude/model-deprecations))     | `claude-opus-4@20250514`     |
| Claude Sonnet 5.5                                                                                     | `claude-sonnet-5-5`          |
| Claude Sonnet 5                                                                                       | `claude-sonnet-5`            |
| Claude Sonnet 4.6                                                                                     | `claude-sonnet-4-6`          |
| Claude Sonnet 4.5 ([deprecated](https://platform.claude.com/docs/en/about-claude/model-deprecations)) | `claude-sonnet-4-5@20250929` |
| Claude Sonnet 4 ([deprecated](https://platform.claude.com/docs/en/about-claude/model-deprecations))   | `claude-sonnet-4@20250514`   |
| Claude Haiku 5.5                                                                                      | `claude-haiku-5-5`           |
| Claude Haiku 4.5                                                                                      | `claude-haiku-4-5@20251001`  |

Claude Models on Google Cloud (Google managed) offers different Claude models in different regions. To check which models a region offers, search “Claude” in [Model Garden](https://cloud.google.com/model-garden) or see Google Cloud’s [Anthropic Claude models on Agent Platform](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/claude) page.

Google sets the lifecycle dates for the models that Claude Models on Google Cloud (Google managed) serves. These dates can differ from the Claude API schedule. For a model’s current retirement date, see Google Cloud’s [Anthropic Claude models on Agent Platform](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/claude) page. For what Deprecated and Retired mean, see [Model deprecations](https://platform.claude.com/docs/en/about-claude/model-deprecations).

<Note>
  Claude Mythos Preview is a research preview. Claude Models on Google Cloud (Google managed) offers it to invited customers. For more information, see [Project Glasswing](https://anthropic.com/glasswing).
</Note>

Let Claude Code migrate your code to a newer model

```text
/claude-api migrate this project to the latest Claude Opus model
```

## Global, multi-region, and regional endpoints

Claude Models on Google Cloud (Google managed) offers three endpoint types. You choose one with the region value you pass when you create the client. In a cURL request, the endpoint type sets the host and the `locations` segment of the URL.

| Endpoint type            | Region value                   | Host                                                                       |
| ------------------------ | ------------------------------ | -------------------------------------------------------------------------- |
| **Global** (recommended) | `"global"`                     | `aiplatform.googleapis.com`                                                |
| **Multi-region**         | `"us"` or `"eu"`               | `aiplatform.us.rep.googleapis.com`<br />`aiplatform.eu.rep.googleapis.com` |
| **Regional**             | A region, such as `"us-east5"` | `{region}-aiplatform.googleapis.com`                                       |

The endpoint types differ in where they send requests:

* **Global:** Requests go to any region with available capacity. Use it when you want maximum availability and data residency is flexible.
* **Multi-region:** Requests go to any region in the United States (`"us"`) or the European Union (`"eu"`). Use it when you need data residency within a broad geography and higher availability than a single region.
* **Regional:** Requests go only to the region you name, such as `"us-east5"` or `"europe-west1"`. Use it when you need single-region data residency or must meet strict compliance mandates.

Multi-region and regional endpoints cost 10 percent more than global endpoints. All three endpoint types take pay-as-you-go traffic, and provisioned throughput needs a regional endpoint.

Regional endpoints serve Claude Sonnet 4.6 and earlier models only. For newer models, use a global or multi-region endpoint.

<Note>
  The premium for multi-region and regional endpoints applies only to Claude Sonnet 4.5 (deprecated) and later models. For the models that keep their earlier pricing, see [Cloud platform pricing](https://platform.claude.com/docs/en/about-claude/pricing#cloud-platform-pricing). For regional endpoints, the premium reflects infrastructure costs for dedicated regional capacity.
</Note>

The following examples use the `us` multi-region endpoint. The highlighted lines set the region. For a full request on the global endpoint, see [Making requests](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/google-managed#accessing-vertex-ai).

<CodeGroup exclude="shell:CLI">
  ```bash cURL
  # The multi-region identifier, "us" or "eu", appears in the hostname and in the path
  curl https://aiplatform.us.rep.googleapis.com/v1/projects/MY_PROJECT_ID/locations/us/publishers/anthropic/models/claude-opus-5-5:rawPredict \
    -H "Authorization: Bearer $(gcloud auth print-access-token)" \
    -H "Content-Type: application/json" \
    -d '{
      "anthropic_version": "2026-10-21",
      "messages": [{"role": "user", "content": "Hey Claude!"}],
      "max_tokens": 100
    }'
  ```

  <CodeGroupItem language="CLI">
    The `ant` CLI doesn’t support Claude Models on Google Cloud (Google managed).
  </CodeGroupItem>

  ```python Python
  from anthropic import AnthropicVertex

  project_id = "MY_PROJECT_ID"
  region = "us"  # Multi-region identifier: "us" or "eu"

  client = AnthropicVertex(project_id=project_id, region=region)
  ```

  ```typescript TypeScript
  import { AnthropicVertex } from "@anthropic-ai/vertex-sdk";

  const projectId = "MY_PROJECT_ID";
  const region = "us"; // Multi-region identifier: "us" or "eu"

  const client = new AnthropicVertex({
    projectId,
    region
  });
  ```

  ```csharp C#
  using Anthropic.Vertex;

  var projectId = "MY_PROJECT_ID";
  var region = "us"; // Multi-region identifier: "us" or "eu"

  var client = new AnthropicVertexClient(new AnthropicVertexCredentials(region, projectId));
  ```

  ```go Go
  import (
  	"context"

  	"github.com/anthropics/anthropic-sdk-go/v2"
  	"github.com/anthropics/anthropic-sdk-go/v2/vertex"
  )
  // ...
  	// Multi-region identifier: "us" or "eu"
  	client := anthropic.NewClient(
  		vertex.WithGoogleAuth(context.Background(), "us", "MY_PROJECT_ID"),
  	)
  ```

  ```java Java
  import com.anthropic.client.AnthropicClient;
  import com.anthropic.client.okhttp.AnthropicOkHttpClient;
  import com.anthropic.vertex.backends.VertexBackend;
  import com.google.auth.oauth2.GoogleCredentials;

  void main() throws Exception {
      // Multi-region identifier: "us" or "eu"
      AnthropicClient client = AnthropicOkHttpClient.builder()
          .backend(
              VertexBackend.builder()
                  .googleCredentials(GoogleCredentials.getApplicationDefault())
                  .region("us")
                  .project("MY_PROJECT_ID")
                  .build()
          )
          .build();
  }
  ```

  ```php PHP
  use Anthropic\Vertex;

  $client = Vertex\Client::fromEnvironment(
      region: 'us', // Multi-region identifier: "us" or "eu"
      projectId: 'MY_PROJECT_ID',
  );
  ```

  ```ruby Ruby
  require "anthropic"

  client = Anthropic::VertexClient.new(
    region: "us", # Multi-region identifier: "us" or "eu"
    project_id: "MY_PROJECT_ID"
  )
  ```
</CodeGroup>

## Feature support

Features supported on Claude Models on Google Cloud (Google managed) include the following:

* [Messages API](https://platform.claude.com/docs/en/api/messages/create)

* [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)

* [Thinking](https://platform.claude.com/docs/en/build-with-claude/thinking)

* [Tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview), including these tools:

  * [Bash tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/bash-tool)
  * [Browser use tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/browser-use-tool)
  * [Computer use tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool)
  * [Memory tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)
  * [Text editor tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/text-editor-tool)
  * [Web search tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool)

* [Citations](https://platform.claude.com/docs/en/build-with-claude/citations)

* [Structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)

* [Fast mode](https://platform.claude.com/docs/en/build-with-claude/fast-mode) on [supported models](https://platform.claude.com/docs/en/build-with-claude/fast-mode#feature-availability)

[Features overview](https://platform.claude.com/docs/en/build-with-claude/overview) lists every feature. Each feature’s page shows whether Claude Models on Google Cloud (Google managed) supports it.

### Features not supported

Claude Models on Google Cloud (Google managed) doesn’t support the following:

* **Input sources:** URL sources for images and documents, and the Files API
* **Server-side tools:** Code execution, web fetch, and advisor
* **Agent infrastructure:** Agent Skills, MCP connector, and programmatic tool calling
* **API endpoints:** Message Batches API, Models API, Admin API, Compliance API, and Usage and Cost API
* **Claude Managed Agents**
* **Server-side fallback:** The [`fallbacks` parameter](https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback#server-side-fallback)

Instead of server-side fallback, use the [client-side fallback pattern](https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback#client-side-fallback).

### Context window

Claude Models on Google Cloud (Google managed) offers a [1M-token context window](https://platform.claude.com/docs/en/build-with-claude/context-windows) for these models:

* Claude Fable 5.2
* Claude Mythos 5.2
* Claude Fable 5.1
* Claude Mythos 5.1
* Claude Fable 5
* Claude Mythos 5
* Claude Opus 5.5
* Claude Opus 5
* Claude Opus 4.8
* Claude Opus 4.7
* Claude Opus 4.6
* Claude Sonnet 5.5
* Claude Sonnet 5
* Claude Sonnet 4.6
* Claude Haiku 5.5

Other Claude models have a 200k-token context window. These include Claude Sonnet 4.5 (deprecated) and Claude Sonnet 4 (deprecated).

Agent Platform limits request payloads to 30 MB. When you send large documents or many images, you might reach this limit before the token limit.

## Billing, rate limits, and logging

### Rate limits

Google Cloud manages rate limits and quotas for Claude Models on Google Cloud (Google managed). For details, including how to request a quota increase, see Google Cloud’s [Quotas for Anthropic Claude models](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/claude/quotas) page.

### Billing

Google Cloud invoices you for Claude Models on Google Cloud (Google managed). For prices, see Google Cloud’s [Generative AI pricing](https://cloud.google.com/vertex-ai/generative-ai/pricing#claude-models) page. Prices also depend on the endpoint type. See [Global, multi-region, and regional endpoints](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/google-managed#global-multi-region-and-regional-endpoints).

### Data retention

Google Cloud governs data handling for Claude Models on Google Cloud (Google managed). For details, see [Agent Platform and zero data retention](https://cloud.google.com/vertex-ai/generative-ai/docs/data-governance).

### Monitoring and logging

To log prompts and completions for Claude Models on Google Cloud (Google managed), use Agent Platform’s [request-response logging service](https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/request-response-logging).

Anthropic recommends that you keep at least the last 30 days of logs. The logs help you understand your activity and investigate possible misuse.

<Note>
  Turning on this service doesn’t give Google or Anthropic any access to your content.
</Note>

## Migrating from Claude Models on Google Cloud (Anthropic managed)

For what changes when you move, see [How the two Google Cloud offerings differ](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/overview#how-the-two-google-cloud-offerings-differ). To move to Claude Models on Google Cloud (Google managed), follow these steps:

<Steps>
  <Step title="Set up access">
    Check that your project and the identity that makes the calls meet the requirements in [Before making API calls](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/google-managed#before-making-api-calls).
  </Step>

  <Step title="Install the SDK package">
    Install the package that provides the client for Claude Models on Google Cloud (Google managed). See [Install an SDK](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/google-managed#install-an-sdk-for-accessing-vertex-ai).
  </Step>

  <Step title="Replace the import and the client">
    Change the code that imports and creates your client. Use `AnthropicVertex` (csharp: `AnthropicVertexClient`; go: `vertex.WithGoogleAuth()`; java: `VertexBackend`; php: `Anthropic\Vertex\Client`; ruby: `Anthropic::VertexClient`) in place of `AnthropicGoogleCloud` (csharp: `AnthropicGoogleCloudClient`; go: `googlecloud.NewClient()`; java: `GoogleCloudBackend`; php: `Anthropic\GoogleCloud\Client`; ruby: `Anthropic::GoogleCloudClient`). A cURL request needs a new URL, new headers, and a new body. The following code creates the client for Claude Models on Google Cloud (Anthropic managed) that you use today:

    <CodeGroup>
      ```bash cURL
      curl "https://claude.googleapis.com/v1/projects/$ANTHROPIC_GOOGLE_CLOUD_PROJECT/locations/global/workspaces/$ANTHROPIC_GOOGLE_CLOUD_WORKSPACE_ID/invoke/v1/messages" \
        -H "Authorization: Bearer $(gcloud auth application-default print-access-token)" \
        -H "content-type: application/json" \
        -H "anthropic-version: 2026-10-21" \
        -d '{
          "model": "claude-opus-5-5",
          "max_tokens": 1024,
          "messages": [
            {"role": "user", "content": "Hello, Claude"}
          ]
        }'
      ```

      ```bash CLI
      ant messages create \
        --model claude-opus-5-5 \
        --max-tokens 1024 \
        --message '{role: user, content: "Hello, Claude"}'
      ```

      ```python Python
      from anthropic import AnthropicGoogleCloud

      client = AnthropicGoogleCloud()
      ```

      ```typescript TypeScript
      import { AnthropicGoogleCloud } from "@anthropic-ai/google-cloud-sdk";

      const client = new AnthropicGoogleCloud();
      ```

      ```csharp C#
      using Anthropic.GoogleCloud;

      var client = new AnthropicGoogleCloudClient();
      ```

      ```go Go
      import (
      	"context"

      	"github.com/anthropics/anthropic-sdk-go/v2"
      	"github.com/anthropics/anthropic-sdk-go/v2/googlecloud"
      )
      // ...
      	client, err := googlecloud.NewClient(context.Background(), googlecloud.ClientConfig{})
      	if err != nil {
      		panic(err)
      	}
      ```

      ```java Java
      import com.anthropic.client.AnthropicClient;
      import com.anthropic.client.okhttp.AnthropicOkHttpClient;
      import com.anthropic.googlecloud.backends.GoogleCloudBackend;

      void main() {
          AnthropicClient client = AnthropicOkHttpClient.builder()
              .backend(GoogleCloudBackend.fromEnv())
              .build();
      }
      ```

      ```php PHP
      use Anthropic\GoogleCloud\Client;

      $client = new Client();
      ```

      ```ruby Ruby
      require "anthropic"

      client = Anthropic::GoogleCloudClient.new
      ```
    </CodeGroup>

    The following code creates the client for Claude Models on Google Cloud (Google managed). It uses the global endpoint. For the other endpoint types, see [Global, multi-region, and regional endpoints](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/google-managed#global-multi-region-and-regional-endpoints).

    <CodeGroup exclude="shell:CLI">
      ```bash cURL
      curl https://aiplatform.googleapis.com/v1/projects/MY_PROJECT_ID/locations/global/publishers/anthropic/models/claude-opus-5-5:rawPredict \
        -H "Authorization: Bearer $(gcloud auth print-access-token)" \
        -H "Content-Type: application/json" \
        -d '{
          "anthropic_version": "2026-10-21",
          "messages": [{"role": "user", "content": "Hey Claude!"}],
          "max_tokens": 100
        }'
      ```

      <CodeGroupItem language="CLI">
        The `ant` CLI doesn’t support Claude Models on Google Cloud (Google managed). Use cURL or an SDK instead.
      </CodeGroupItem>

      ```python Python
      from anthropic import AnthropicVertex

      project_id = "MY_PROJECT_ID"
      region = "global"

      client = AnthropicVertex(project_id=project_id, region=region)
      ```

      ```typescript TypeScript
      import { AnthropicVertex } from "@anthropic-ai/vertex-sdk";

      const projectId = "MY_PROJECT_ID";
      const region = "global";

      const client = new AnthropicVertex({
        projectId,
        region
      });
      ```

      ```csharp C#
      using Anthropic.Vertex;

      var projectId = "MY_PROJECT_ID";
      var region = "global";

      var client = new AnthropicVertexClient(new AnthropicVertexCredentials(region, projectId));
      ```

      ```go Go
      import (
      	"context"

      	"github.com/anthropics/anthropic-sdk-go/v2"
      	"github.com/anthropics/anthropic-sdk-go/v2/vertex"
      )
      // ...
      	// Uses default Google Cloud credentials
      	client := anthropic.NewClient(
      		vertex.WithGoogleAuth(context.Background(), "global", "MY_PROJECT_ID"),
      	)
      ```

      ```java Java
      import com.anthropic.client.AnthropicClient;
      import com.anthropic.client.okhttp.AnthropicOkHttpClient;
      import com.anthropic.vertex.backends.VertexBackend;
      import com.google.auth.oauth2.GoogleCredentials;

      void main() throws Exception {
          AnthropicClient client = AnthropicOkHttpClient.builder()
              .backend(
                  VertexBackend.builder()
                      .googleCredentials(GoogleCredentials.getApplicationDefault())
                      .region("global")
                      .project("MY_PROJECT_ID")
                      .build()
              )
              .build();
      }
      ```

      ```php PHP
      use Anthropic\Vertex;

      $client = Vertex\Client::fromEnvironment(
          region: 'global',
          projectId: 'MY_PROJECT_ID',
      );
      ```

      ```ruby Ruby
      require "anthropic"

      client = Anthropic::VertexClient.new(
        region: "global",
        project_id: "MY_PROJECT_ID"
      )
      ```
    </CodeGroup>

    This code passes your project ID and a region when it creates the client. Replace `MY_PROJECT_ID` with your project ID. The Messages API calls that you make with the client stay as they are. The exceptions are the model IDs and features in the next step.
  </Step>

  <Step title="Check model IDs and features">
    * **Model IDs:** If you use a model earlier than Claude 4.6, replace the hyphen before the snapshot date in its ID with `@`. For example, `claude-haiku-4-5-20251001` becomes `claude-haiku-4-5@20251001`. For the models and their IDs, see [API model IDs](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/google-managed#api-model-ids).
    * **Features:** Check that the features your code uses aren’t listed in [Features not supported](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/google-managed#features-not-supported).
  </Step>

  <Step title="Run a test request">
    Run the request in [Making requests](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/google-managed#accessing-vertex-ai) to check that your setup works. Then run your own code. Before you move production traffic, read about [rate limits for Claude Models on Google Cloud (Google managed)](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/google-managed#rate-limits).
  </Step>
</Steps>

## Next steps

<CardGroup cols={2}>
  <Card title="Features overview" icon="stack" href="https://platform.claude.com/docs/en/build-with-claude/overview">
    Explore Claude’s features.
  </Card>

  <Card title="Anthropic Claude models on Agent Platform" icon="book" href="https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/claude">
    Check which Claude models each region offers, and their retirement dates.
  </Card>

  <Card title="Agent Platform documentation" icon="book" href="https://cloud.google.com/vertex-ai/docs">
    Read Google Cloud’s Agent Platform documentation.
  </Card>

  <Card title="Global endpoint for Claude models" icon="link" href="https://cloud.google.com/blog/products/ai-machine-learning/global-endpoint-for-claude-models-generally-available-on-vertex-ai">
    Read Google Cloud’s blog post about the global endpoint for Claude models.
  </Card>
</CardGroup>
