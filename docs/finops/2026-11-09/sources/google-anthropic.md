---
title: Claude Models on Google Cloud (Anthropic managed)
url: https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed
description: Claude Models on Google Cloud (Anthropic managed) is the Claude API, run by Anthropic and reached through your Google Cloud project.
---

Google Cloud handles access and billing for Claude Models on Google Cloud (Anthropic managed). To compare the two Google Cloud offerings, or to check which one you use, see [Claude Models on Google Cloud](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/overview).

## Set up your account

To set up your account for Claude Models on Google Cloud (Anthropic managed), you need the following:

* Permission to purchase in Google Cloud Marketplace on your billing account
* Permission to enable services on the project
* An [IAM role that lets you open the Claude Console](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed#using-the-claude-console), which you need for step 4

These steps create a new Anthropic organization for your Google Cloud project. It’s separate from any Anthropic organization your company already has. That includes a Claude Enterprise organization. To move from an existing organization, see [Moving from an existing Anthropic organization](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed#moving-from-an-existing-anthropic-organization).

If you have an existing discount, contact your Anthropic or Google Cloud account representative before you start these steps. Discounts can’t be applied to past usage.

<Steps>
  <Step title="Subscribe in Marketplace">
    1. Open [Google Cloud Marketplace](https://console.cloud.google.com/marketplace) and find the **Claude Models on Google Cloud (Anthropic managed)** listing.
    2. Click **Subscribe** and complete the purchase flow.
    3. Return to the listing and click **Manage on Console**. This opens the Claude page in the Google Cloud console.

    To return to the Claude page later, select your project in the Google Cloud console. Then go to **Agent Platform > Models > Claude Platform** and select **Anthropic managed**.
  </Step>

  <Step title="Enable the services">
    Enable two services on every project that calls Claude Models on Google Cloud (Anthropic managed):

    * `claude.googleapis.com` serves the API for Claude Models on Google Cloud (Anthropic managed). This service also defines the IAM permissions. Calls fail without it.
    * `anthropic-managed-claude.cloudpartnerservices.goog` is the Marketplace service that attributes the project’s usage to your subscription.

    ```bash CLI
    gcloud services enable claude.googleapis.com \
      anthropic-managed-claude.cloudpartnerservices.goog \
      --project=my-project-id
    ```

    Replace `my-project-id` with your project ID.

    You can also enable both from the Claude page or from **APIs & Services**. Enabling is a one-time step for each project. To check that both services are enabled, run `gcloud services list --enabled --project=my-project-id` and look for both names.
  </Step>

  <Step title="Set up your Anthropic organization">
    1. On the Claude page, click **Activate**.
    2. In the Anthropic setup flow, enter a contact email address.
    3. Open the setup link sent to that address.
    4. Fill in the organization’s name, entity type, country, and intended use.
    5. Accept Anthropic’s Commercial Terms of Service and Usage Policy.

    The contact address is used only for setup and service notices. For how people open the Claude Console after setup, see [Using the Claude Console](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed#using-the-claude-console).
  </Step>

  <Step title="Open the Claude Console">
    When your Anthropic organization is active, the button on the Claude page changes to **Open Claude Console**. Click it. Google Cloud checks your IAM access. Then it redirects your browser to `platform.claude.com`. You’re signed in to the new organization.

    While you’re in the Claude Console, [find your workspace ID](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed#find-your-workspace-id) and copy it. Everyone who calls Claude Models on Google Cloud (Anthropic managed) needs it. Pass it on to your developers.
  </Step>
</Steps>

To add another project, repeat these steps in that project, starting from step 2.

### Troubleshooting account setup

If you run into one of the following problems while you set up Claude Models on Google Cloud (Anthropic managed), apply its fix:

* **`gcloud services enable` can’t find `anthropic-managed-claude.cloudpartnerservices.goog`:** Run the command as the account that completed the Marketplace purchase, or contact your Anthropic account representative.
* **A permission error on your first API call:** Check that `claude.googleapis.com` is enabled on the project you’re calling. Check that the caller has `roles/claude.user` or `roles/claude.admin` on that project. For what each role allows, see [IAM roles](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed#iam-roles). A new grant or a newly enabled service can take a moment to apply.
* **“Signed in as a different account” after following the setup link:** Click **Log out and continue**. Then use the email address you entered in step 3.
* **The button says “Finish Setup” instead of “Open Claude Console”:** Your Anthropic organization exists, but its setup isn’t complete. An administrator has to finish the organization details form.
* **The Usage page shows no data after your first API call:** Usage data can take a few minutes to appear in the Claude Console.

## Manage access

### IAM roles

Claude Models on Google Cloud (Anthropic managed) has three predefined IAM roles. Grant roles on the project.

| Role                  | Display name  | What it allows                                                                                                                                                                                                                          |
| --------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `roles/claude.viewer` | Claude Viewer | Every `get` and `list` permission on workspace resources<br />This role is read-only.                                                                                                                                                   |
| `roles/claude.user`   | Claude User   | Everything `roles/claude.viewer` allows, plus creating and changing workspace resources<br />This includes sending messages and counting tokens. It also includes managing batches, files, skills, and Claude Managed Agents resources. |
| `roles/claude.admin`  | Claude Admin  | Everything `roles/claude.user` allows, plus the permissions checked on your Anthropic organization<br />Organization-level routes act on your Anthropic organization as a whole, not on one workspace.                                  |

For example, the following command lets a service account call Claude Models on Google Cloud (Anthropic managed):

```bash CLI
gcloud projects add-iam-policy-binding my-project-id \
  --member="serviceAccount:my-app@my-project-id.iam.gserviceaccount.com" \
  --role="roles/claude.user"
```

For permissions, predefined roles, and audit log types, see [IAM permissions for Claude Models on Google Cloud (Anthropic managed)](https://platform.claude.com/docs/en/api/claude-models-on-google-cloud-anthropic-managed-iam-permissions).

Enabling `claude.googleapis.com` creates a service agent for the project. Don’t remove its role grants. Removing them stops Claude Models on Google Cloud (Anthropic managed) from working in the project.

### Using the Claude Console

With Claude Models on Google Cloud (Anthropic managed), you can’t use an email address to sign in to your Anthropic organization. Instead, click **Open Claude Console** on the [Claude page](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed#set-up-your-account) in the Google Cloud console. Google Cloud IAM controls who can open the Claude Console. Of the three predefined [IAM roles](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed#iam-roles), only `roles/claude.admin` on the project lets you open the Claude Console.

### Workspaces

In Claude Models on Google Cloud (Anthropic managed), setup creates your Anthropic organization with one workspace, the Default Workspace. To create more workspaces, [open the Claude Console](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed#using-the-claude-console) and go to **Settings > Workspaces**. On the same page, you can rename or archive any workspace except the Default Workspace. Each workspace has its own [workspace ID](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed#find-your-workspace-id). Files, skills, batches, Claude Managed Agents sessions, and other workspace resources belong to the workspace whose ID you [set for the request](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed#project-location-and-workspace-resolution).

You grant [IAM roles](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed#iam-roles) on the project, so a role applies to every workspace in that project. When teams need separate access, give each team its own Google Cloud project. Each project has its own Anthropic organization, so repeat the [setup steps](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed#set-up-your-account) in each project, starting from step 2.

## Before making API calls

To call Claude Models on Google Cloud (Anthropic managed), you need the following:

1. A Google Cloud project with an active subscription and an Anthropic organization whose setup is complete. See [Set up your account](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed#set-up-your-account).
2. The [gcloud CLI](https://cloud.google.com/sdk/docs/install) installed, for local development.
3. The `roles/claude.user` role, granted on the project to the identity that makes the calls.
4. Application Default Credentials for that identity. See [Authentication](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed#authentication).
5. Your project ID and your [workspace ID](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed#find-your-workspace-id).

To grant the role to your own account for local development, run the following command. You need permission to change the project’s IAM policy.

```bash CLI
gcloud projects add-iam-policy-binding my-project-id \
  --member="user:you@example.com" \
  --role="roles/claude.user"
```

Replace `my-project-id` with your project ID. Replace `you@example.com` with your Google account’s email address. To see the project gcloud is using, run `gcloud config get-value project`. For service accounts and the other roles, see [IAM roles](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed#iam-roles).

### Find your workspace ID

To find your workspace ID for Claude Models on Google Cloud (Anthropic managed), [open the Claude Console](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed#using-the-claude-console) and go to **Settings > Workspaces**. The ID starts with `wrkspc_`. If you can’t open the Claude Console, ask someone who can open it to send you the ID.

Set the project and workspace as environment variables so that the SDK client and the [`ant` CLI](https://platform.claude.com/docs/en/cli-sdks-libraries/cli/quickstart) pick them up:

```bash CLI
export ANTHROPIC_GOOGLE_CLOUD_PROJECT="my-project-id"
export ANTHROPIC_GOOGLE_CLOUD_WORKSPACE_ID="wrkspc_01AbCdEf23GhIj"
```

### Install an SDK

The [SDK client](https://platform.claude.com/docs/en/cli-sdks-libraries/overview) for Claude Models on Google Cloud (Anthropic managed) is `AnthropicGoogleCloud` (csharp: `AnthropicGoogleCloudClient`; go: `googlecloud.NewClient()`; java: `GoogleCloudBackend`; php: `Anthropic\GoogleCloud\Client`; ruby: `Anthropic::GoogleCloudClient`). The client resolves your Google credentials. It also builds the base URL from your project, location, and workspace ID.

<Note>
  The SDK client for Claude Models on Google Cloud (Anthropic managed) is in beta.
</Note>

Install the package that provides the client:

<Tabs>
  <Tab title="Python">
    ```bash
    pip install -U "anthropic[google_cloud]"
    ```
  </Tab>

  <Tab title="TypeScript">
    ```bash
    npm install @anthropic-ai/google-cloud-sdk
    ```
  </Tab>

  <Tab title="C#">
    ```bash
    dotnet add package Anthropic.GoogleCloud
    ```
  </Tab>

  <Tab title="Go">
    ```bash
    go get github.com/anthropics/anthropic-sdk-go/v2/googlecloud
    ```
  </Tab>

  <Tab title="Java">
    <Tabs>
      <Tab title="Gradle">
        ```kotlin
        implementation("com.anthropic:anthropic-java:3.7.0")
        implementation("com.anthropic:anthropic-java-google-cloud:3.7.0")
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
            <artifactId>anthropic-java-google-cloud</artifactId>
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
    gem install anthropic googleauth
    ```
  </Tab>
</Tabs>

To use the `ant` CLI instead, [install or update the CLI](https://platform.claude.com/docs/en/cli-sdks-libraries/cli/quickstart#installation) to the latest version. A version without support for Claude Models on Google Cloud (Anthropic managed) ignores the `ANTHROPIC_GOOGLE_CLOUD_*` variables. It then does one of the following:

* Sends the request to the Claude API with any other credential you’ve set up
* Fails with an authentication error

## Making requests

Claude Models on Google Cloud (Anthropic managed) serves Claude API endpoints under a base URL that names your project, a location, and your workspace:

```text wrap
https://claude.googleapis.com/v1/projects/{project}/locations/global/workspaces/{workspace}/invoke
```

The [organization-level routes](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed#iam-roles), whose paths start with `/v1/organizations/`, and the [user profile](https://platform.claude.com/docs/en/manage-claude/user-profiles) routes under `/v1/user_profiles` use a base URL without the workspace:

```text wrap
https://claude.googleapis.com/v1/projects/{project}/locations/global/claudeOrganization/invoke
```

If you don’t [set the base URL](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed#project-location-and-workspace-resolution), the SDK client chooses between these two for each request.

Append the Claude API path to the base URL. For example, the [Messages API](https://platform.claude.com/docs/en/api/messages/create) is at `.../invoke/v1/messages`. Three things differ from a Claude API request:

* **Base URL:** The project-scoped URLs shown earlier, in place of `https://api.anthropic.com`.
* **Authentication:** An `Authorization: Bearer` header with a Google access token. Don’t send an `x-api-key` header.
* **Workspace:** The workspace ID is part of the URL. Don’t send an `anthropic-workspace-id` header.

Everything else is the same as on the Claude API, including the following:

* The `anthropic-version` and `anthropic-beta` headers
* The request body
* Streaming
* The response

Code samples elsewhere in this documentation create the Claude API client and read an API key. To run one with Claude Models on Google Cloud (Anthropic managed), replace its import and client constructor with the ones in the following examples. For a cURL sample, apply the three differences listed earlier.

Before running these examples, complete the steps in [Before making API calls](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed#before-making-api-calls).

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

  message = client.messages.create(
      model="claude-opus-5-5",
      max_tokens=1024,
      messages=[{"role": "user", "content": "Hello, Claude"}],
  )
  print(message)
  ```

  ```typescript TypeScript
  import { AnthropicGoogleCloud } from "@anthropic-ai/google-cloud-sdk";

  const client = new AnthropicGoogleCloud();

  const message = await client.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 1024,
    messages: [{ role: "user", content: "Hello, Claude" }]
  });
  console.log(message);
  ```

  ```csharp C#
  using Anthropic.GoogleCloud;
  using Anthropic.Models.Messages;

  var client = new AnthropicGoogleCloudClient();

  var parameters = new MessageCreateParams
  {
      Model = Model.ClaudeOpus5_5,
      MaxTokens = 1024,
      Messages = [new UserMessageParam { Content = "Hello, Claude" }]
  };

  var message = await client.Messages.Create(parameters);
  Console.WriteLine(message);
  ```

  ```go Go
  import (
  	"context"
  	"fmt"

  	"github.com/anthropics/anthropic-sdk-go/v2"
  	"github.com/anthropics/anthropic-sdk-go/v2/googlecloud"
  )

  func main() {
  	client, err := googlecloud.NewClient(context.Background(), googlecloud.ClientConfig{})
  	if err != nil {
  		panic(err)
  	}

  	message, err := client.Messages.New(context.Background(), anthropic.MessageNewParams{
  		Model:     anthropic.ModelClaudeOpus5_5,
  		MaxTokens: 1024,
  		Messages: []anthropic.MessageParam{
  			anthropic.NewUserMessage(anthropic.NewTextBlock("Hello, Claude")),
  		},
  	})
  	if err != nil {
  		panic(err)
  	}

  	fmt.Println(message)
  }
  ```

  ```java Java
  import com.anthropic.client.AnthropicClient;
  import com.anthropic.client.okhttp.AnthropicOkHttpClient;
  import com.anthropic.googlecloud.backends.GoogleCloudBackend;
  import com.anthropic.models.messages.Message;
  import com.anthropic.models.messages.MessageCreateParams;
  import com.anthropic.models.messages.Model;

  void main() {
      AnthropicClient client = AnthropicOkHttpClient.builder()
          .backend(GoogleCloudBackend.fromEnv())
          .build();

      Message message = client.messages().create(
          MessageCreateParams.builder()
              .model(Model.CLAUDE_OPUS_5_5)
              .maxTokens(1024)
              .addUserMessage("Hello, Claude")
              .build()
      );

      IO.println(message);
  }
  ```

  ```php PHP
  use Anthropic\GoogleCloud\Client;
  use Anthropic\Messages\Model;

  $client = new Client();

  $message = $client->messages->create(
      model: Model::CLAUDE_OPUS_5_5,
      maxTokens: 1024,
      messages: [['role' => 'user', 'content' => 'Hello, Claude']],
  );

  echo $message;
  ```

  ```ruby Ruby
  require "anthropic"

  client = Anthropic::GoogleCloudClient.new

  message = client.messages.create(
    model: Anthropic::Model::CLAUDE_OPUS_5_5,
    max_tokens: 1024,
    messages: [{ role: "user", content: "Hello, Claude" }]
  )

  puts message
  ```
</CodeGroup>

The cURL example asks gcloud for an Application Default Credentials token. Access tokens are short-lived. Generate one for each session instead of storing it.

### API model IDs

Claude Models on Google Cloud (Anthropic managed) uses the same model IDs as the Claude API, for example `claude-opus-5-5`. For the models and their IDs, see [Models overview](https://platform.claude.com/docs/en/models/overview).

In Claude Models on Google Cloud (Anthropic managed), a request for a model that isn’t available to your Anthropic organization returns an error. The error message reads `Model {model} is not available for this organization's inference configuration.`

## Project, location, and workspace resolution

The client for Claude Models on Google Cloud (Anthropic managed) takes the settings in the following table. A value you pass when you create the client wins over the environment variable. To set the project and workspace ID explicitly, pass `project` (go: `Project`; java: `.project()`; csharp: `GoogleCloudClientOptions.Project`; cli: `--google-cloud-project`) and `workspace_id` (typescript, php: `workspaceId`; go: `WorkspaceID`; java: `.workspaceId()`; csharp: `GoogleCloudClientOptions.WorkspaceId`; cli: `--google-cloud-workspace-id`).

| Setting      | Environment variable                                          | If unset                                                                                                                                                                                                                                                                                                                   |
| ------------ | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project ID   | `ANTHROPIC_GOOGLE_CLOUD_PROJECT`, then `GOOGLE_CLOUD_PROJECT` | The project that Application Default Credentials reports, when the credential type carries one                                                                                                                                                                                                                             |
| Workspace ID | `ANTHROPIC_GOOGLE_CLOUD_WORKSPACE_ID`                         | The client raises an error unless you set the base URL. [Organization-level routes](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed#iam-roles) and [user profile](https://platform.claude.com/docs/en/manage-claude/user-profiles) routes don’t need a workspace ID. |
| Location     | `ANTHROPIC_GOOGLE_CLOUD_LOCATION`                             | `global`                                                                                                                                                                                                                                                                                                                   |
| Base URL     | `ANTHROPIC_GOOGLE_CLOUD_BASE_URL`                             | Derived from the project, location, and workspace ID                                                                                                                                                                                                                                                                       |

Leave the location at `global`. The location is separate from where inference runs, so for US-only inference, set `inference_geo: "us"` on each request, as described in [Data residency](https://platform.claude.com/docs/en/manage-claude/data-residency#inference-geo).

The `ant` CLI takes the same settings as flags:

* **Project ID:** `--google-cloud-project`
* **Workspace ID:** `--google-cloud-workspace-id`
* **Location:** `--google-cloud-location`
* **Base URL:** `--google-cloud-base-url`

The CLI uses Claude Models on Google Cloud (Anthropic managed) when the project, workspace ID, or location is set. Setting `GOOGLE_CLOUD_PROJECT`, the base URL, or both isn’t enough.

## Authentication

Each request to Claude Models on Google Cloud (Anthropic managed) carries a Google OAuth 2.0 access token in an `Authorization: Bearer` header. The token has the `https://www.googleapis.com/auth/cloud-platform` scope.

Google Cloud handles access. Its gateway at `claude.googleapis.com` does the following for each request:

1. Checks your Google Cloud credentials.
2. Checks that the caller holds the IAM permission that the request needs. If the caller doesn’t, Google Cloud returns an HTTP 403 error.
3. Forwards the request to Anthropic. Anthropic validates the request.

To grant permissions, see [IAM roles](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed#iam-roles).

The SDK client gets the token from [Application Default Credentials](https://cloud.google.com/docs/authentication/application-default-credentials) (ADC). Any credential source that ADC supports works:

* **Local development:** Run `gcloud auth application-default login`.
* **On Google Cloud:** The client automatically uses the service account attached to the workload, for example on Compute Engine, GKE, or Cloud Run.
* **A service account key file:** Set `GOOGLE_APPLICATION_CREDENTIALS` to its path.
* **Workload Identity Federation and service account impersonation:** Configure them as you would for any Google Cloud API.

Check that ADC is working:

```bash CLI
gcloud auth application-default print-access-token
```

Claude Models on Google Cloud (Anthropic managed) doesn’t use API keys. In the Claude Console, you can’t create API keys for the Anthropic organization that setup creates. The SDK client for Claude Models on Google Cloud (Anthropic managed) ignores these environment variables:

* `ANTHROPIC_API_KEY`
* `ANTHROPIC_AUTH_TOKEN`
* `ANTHROPIC_BASE_URL`

### Credential precedence

The SDK client for Claude Models on Google Cloud (Anthropic managed) checks for credentials in the following order. The client uses the first one it finds:

1. A token provider that you pass as `token_provider` (typescript: `bearerTokenProvider`; csharp: `GoogleCloudClientOptions.TokenProvider`; go: `TokenSource`; java: `.bearerTokenSupplier()`; php: `tokenProvider`) when you create the client. It’s a function or token source that returns an access token. The client asks it for a token on every request. Caching and refreshing the token are up to you.
2. A Google credentials object that you pass as `credentials` (typescript: `googleAuth`; csharp: `GoogleCloudClientOptions.GoogleCredential`; java: `.googleCredentials()`; php: `googleCredentials`; ruby: `google_credentials`) when you create the client. The Go SDK doesn’t have this option.
3. Application Default Credentials.

Go and Java differ from the other SDKs:

* **Go:** For option 1, the client takes an `oauth2.TokenSource`. It caches the token until the token expires.
* **Java:** Use `GoogleCloudBackend.fromEnv()` to read Application Default Credentials and the environment variables in [Project, location, and workspace resolution](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed#project-location-and-workspace-resolution).

The client has no environment variable of its own for the credential. Use ADC’s `GOOGLE_APPLICATION_CREDENTIALS` instead.

If your requests go through a proxy that attaches the token for you, set `skip_auth` (typescript, php: `skipAuth`; go: `SkipAuth`; java: `.skipAuth()`; csharp: `GoogleCloudClientOptions.SkipAuth`). The client then sends no `Authorization` header. You can’t combine this setting with the preceding credential options.

When the `ant` CLI uses Claude Models on Google Cloud (Anthropic managed), it always gets the token from Application Default Credentials. It takes no token provider, credentials object, or setting to skip authentication.

Before you use `ant` with Claude Models on Google Cloud (Anthropic managed), make sure none of these is set:

* An API key

* An authentication token

* `--profile` or `ANTHROPIC_PROFILE`, if it names a [configuration profile](https://platform.claude.com/docs/en/manage-claude/wif-reference#profile-configuration-file) that the CLI can authenticate with

* Any of Anthropic’s federation variables:

  * `ANTHROPIC_FEDERATION_RULE_ID`
  * `ANTHROPIC_ORGANIZATION_ID`
  * `ANTHROPIC_SERVICE_ACCOUNT_ID`
  * `ANTHROPIC_IDENTITY_TOKEN`
  * `ANTHROPIC_IDENTITY_TOKEN_FILE`

If one is set, the CLI uses that credential instead of the Google Cloud settings from [Find your workspace ID](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed#find-your-workspace-id). If only some of the federation variables are set, the CLI stops with an error. When more than one credential is set, the CLI prints a note naming the one it uses.

Also leave `ANTHROPIC_WORKSPACE_ID` and the `--workspace-id` flag unset. The CLI still sends that value as an `anthropic-workspace-id` header. Requests to Claude Models on Google Cloud (Anthropic managed) must not carry that header. Set the workspace with `--google-cloud-workspace-id` or `ANTHROPIC_GOOGLE_CLOUD_WORKSPACE_ID` instead.

Like the SDK client, the CLI doesn’t send requests for Claude Models on Google Cloud (Anthropic managed) to `--base-url` or `ANTHROPIC_BASE_URL`.

## Feature support

This section lists features that work on Claude Models on Google Cloud (Anthropic managed) and features that aren’t supported there. It doesn’t list every Claude API feature, and it doesn’t say whether an unlisted feature works.

The Models API and the following features are available on Claude Models on Google Cloud (Anthropic managed):

* [Advisor tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool) (Beta)
* [Agent Skills](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)
  * [Custom Skills](https://platform.claude.com/docs/en/build-with-claude/skills-guide#managing-custom-skills)
  * [Pre-built Agent Skills](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview#pre-built-agent-skills)
* [Batch processing](https://platform.claude.com/docs/en/build-with-claude/batch-processing)
* [Classifier refusals](https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback)
  * [Client-side fallback](https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback#client-side-fallback) (Beta)
  * [Server-side fallback](https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback#server-side-fallback) (Beta)
* [Code execution tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/code-execution-tool)
* [Custom tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools)
* [Data residency](https://platform.claude.com/docs/en/manage-claude/data-residency)
* [Effort](https://platform.claude.com/docs/en/build-with-claude/effort)
  * [Per-message effort](https://platform.claude.com/docs/en/build-with-claude/effort#change-effort-mid-conversation-beta) (Beta)
* [Fast mode](https://platform.claude.com/docs/en/build-with-claude/fast-mode)
* [Files API](https://platform.claude.com/docs/en/build-with-claude/files)
* [MCP connector](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector) (Beta)
  * [Client-side MCP helpers](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector#client-side-mcp-helpers) (Beta)
* [Memory tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)
  * [Memory tool helpers](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool#implement-the-memory-handler) (Beta)
* [Message streaming](https://platform.claude.com/docs/en/build-with-claude/streaming)
* [Message threads](https://platform.claude.com/docs/en/build-with-claude/message-threads) (Beta)
* [Mid-conversation system messages](https://platform.claude.com/docs/en/build-with-claude/mid-conversation-system-messages)
  * [Mid-conversation tool changes](https://platform.claude.com/docs/en/build-with-claude/mid-conversation-system-messages#mid-conversation-tool-changes) (Beta)
  * [Turn-scoped system messages](https://platform.claude.com/docs/en/build-with-claude/mid-conversation-system-messages#turn-scoped-system-messages) (Beta)
* [OpenTelemetry](https://platform.claude.com/docs/en/manage-claude/opentelemetry) (Beta)
* [PDF support](https://platform.claude.com/docs/en/build-with-claude/pdf-support)
* [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
  * [1-hour duration](https://platform.claude.com/docs/en/build-with-claude/prompt-caching#1-hour-cache-duration)
  * [5-minute duration (default)](https://platform.claude.com/docs/en/build-with-claude/prompt-caching#how-prompt-caching-works)
  * [Automatic caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching#automatic-caching)
* [SDK middleware](https://platform.claude.com/docs/en/cli-sdks-libraries/middleware)
* [Structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
  * [Typed structured output helpers](https://platform.claude.com/docs/en/build-with-claude/structured-outputs#usage)
* [Thinking](https://platform.claude.com/docs/en/build-with-claude/thinking)
  * [Adaptive thinking](https://platform.claude.com/docs/en/build-with-claude/thinking-steering-and-cost)
  * [Extended thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking)
  * [Preserved thinking](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking)
* [Token counting](https://platform.claude.com/docs/en/build-with-claude/token-counting)
* [Tool runner](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-runner) (Beta)
* [Vision (images)](https://platform.claude.com/docs/en/build-with-claude/vision)
* [Web fetch tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool)
* [Web search tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool)

If a beta feature is limited to selected organizations on the Claude API, the Anthropic organization that setup creates needs the same access.

To turn the [Compliance API](https://platform.claude.com/docs/en/manage-claude/compliance-api) on or off for the Anthropic organization that setup creates, [open the Claude Console](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed#using-the-claude-console), go to **Settings > Compliance**, and use the **Compliance API** toggle.

Customer-managed encryption keys (CMEK) are available with Google Cloud KMS keys. To activate CMEK for the Anthropic organization that setup creates, see [Who can use CMEK](https://platform.claude.com/docs/en/manage-claude/cmek#availability). To set up a key, follow [Set up CMEK with Google Cloud KMS](https://platform.claude.com/docs/en/manage-claude/cmek-google-cloud-kms). Then register, verify, and attach the key in the [Claude Console](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed#using-the-claude-console), as the setup page’s **Claude Platform** tab describes.

### Claude Managed Agents

[Claude Managed Agents](https://platform.claude.com/docs/en/managed-agents/overview) is available through Claude Models on Google Cloud (Anthropic managed), including [sessions](https://platform.claude.com/docs/en/managed-agents/sessions) and the following features:

* [Agent configurations](https://platform.claude.com/docs/en/managed-agents/agent-setup) (Beta)
* [Cloud sandboxes](https://platform.claude.com/docs/en/managed-agents/environments) (Beta)
* [Event deltas](https://platform.claude.com/docs/en/managed-agents/event-deltas) (Beta)
* [GitHub access](https://platform.claude.com/docs/en/managed-agents/github) (Beta)
* [Memory stores](https://platform.claude.com/docs/en/managed-agents/memory) (Beta)
* [Multiagent orchestration](https://platform.claude.com/docs/en/managed-agents/multiagent-orchestration) (Beta)
  * [Dynamic workflows](https://platform.claude.com/docs/en/managed-agents/workflow-runs) (Beta)
  * [Session threads](https://platform.claude.com/docs/en/managed-agents/session-threads) (Beta)
* [Outcomes](https://platform.claude.com/docs/en/managed-agents/define-outcomes) (Beta)
* [Permission policies](https://platform.claude.com/docs/en/managed-agents/permission-policies) (Beta)
* [Scheduled deployments](https://platform.claude.com/docs/en/managed-agents/scheduled-deployments) (Beta)
* [Self-hosted sandboxes](https://platform.claude.com/docs/en/managed-agents/self-hosted-sandboxes) (Beta)
* [Session budgets](https://platform.claude.com/docs/en/managed-agents/budgets) (Beta)
* [Vaults](https://platform.claude.com/docs/en/managed-agents/vaults) (Beta)
* [Web domain restrictions](https://platform.claude.com/docs/en/managed-agents/tools-web-restrictions) (Beta)

Access is checked when a session or a deployment is created, not while it runs:

* **Running sessions keep running.** If you revoke Google Cloud access from the identity that created a session, the session doesn’t stop. To stop it, send it a [`user.interrupt` event](https://platform.claude.com/docs/en/managed-agents/events-and-streaming#integrating-events) by itself. After the session is `idle`, you can archive or delete it.
* **Scheduled deployments keep running.** A deployment doesn’t re-check its creator’s access on each scheduled run. To stop it, pause, update, or archive it.

When you remove a user or rotate a service account, review the sessions and deployments that identity created.

### Features not supported

The following aren’t supported on Claude Models on Google Cloud (Anthropic managed):

* **API keys:** Authentication is through Google Cloud credentials only.
* **MCP tunnels:** [MCP tunnels](https://platform.claude.com/docs/en/agents-and-tools/mcp-tunnels/overview) aren’t available on Claude Models on Google Cloud (Anthropic managed).
* **[Memory stores on self-hosted environments](https://platform.claude.com/docs/en/managed-agents/self-hosted-sandboxes-memory):** Memory stores aren’t supported for sessions on self-hosted environments.
* **Pre-built self-hosted sandbox workers:** The [self-hosted workers](https://platform.claude.com/docs/en/managed-agents/self-hosted-sandboxes-workers) in the `ant` CLI and in the Python, TypeScript, and Go SDKs don’t support Claude Models on Google Cloud (Anthropic managed). Instead, implement your own worker that calls the [Environments Work endpoints](https://platform.claude.com/docs/en/api/beta/environments/work) directly. For the roles and permissions your worker needs, see [IAM permissions for environments](https://platform.claude.com/docs/en/api/claude-models-on-google-cloud-anthropic-managed-iam-permissions#environments).

### Context window

Context window sizes on Claude Models on Google Cloud (Anthropic managed) are the same as on the Claude API. For each model’s limit, see [Context windows](https://platform.claude.com/docs/en/build-with-claude/context-windows).

## Billing, rate limits, and logging

### Rate limits

Anthropic manages rate limits for Claude Models on Google Cloud (Anthropic managed). To request higher limits, contact your Anthropic account representative or [contact sales](https://claude.com/contact-sales). For how rate limits are measured and reported, see [Rate limits](https://platform.claude.com/docs/en/api/rate-limits).

### Billing

Claude Models on Google Cloud (Anthropic managed) bills through Google Cloud Marketplace. Anthropic meters your usage. It reports the usage to Google Cloud in Claude Consumption Units. One Claude Consumption Unit is $0.01 USD. The charges appear on your Google Cloud bill. Anthropic doesn’t send a separate invoice.

View usage and cost data on the **Usage** and **Cost** pages in the [Claude Console](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed#using-the-claude-console), or query it with the [Usage and Cost Analytics API](https://platform.claude.com/docs/en/manage-claude/usage-cost-analytics-api).

If you have a Google Cloud spend commitment, usage counts toward it the way other Marketplace purchases do.

### Data retention

Anthropic is the data processor for Claude Models on Google Cloud (Anthropic managed). Some supporting services, such as Anthropic’s trust and safety systems, process data outside Google Cloud.

Claude Models on Google Cloud (Anthropic managed) follows the same data retention policy as the Claude API. See [API and data retention](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention). Zero Data Retention (ZDR) is available on request. Contact your Anthropic account representative.

A ZDR arrangement on another Anthropic organization doesn’t carry over to your organization for Claude Models on Google Cloud (Anthropic managed).

### Monitoring and logging

[Cloud Audit Logs](https://cloud.google.com/logging/docs/audit) records API activity for Claude Models on Google Cloud (Anthropic managed) in your project. The entries appear under the `claude.googleapis.com` service. Each API route belongs to one of two log types:

* **Data Access logs:** These cover most routes, including messages, batches, files, skills, models, and most Claude Managed Agents resources. They’re off by default.
* **Admin Activity logs:** These cover the other routes, including the encryption key routes and most credential vault routes. The exception is the route for `vaults.verify`, which is Data Access. Admin Activity logs are always on.

To keep a record of requests, turn on Data Access logs for `claude.googleapis.com` in your project’s audit log settings.

For audit log types by route, see [IAM permissions for Claude Models on Google Cloud (Anthropic managed)](https://platform.claude.com/docs/en/api/claude-models-on-google-cloud-anthropic-managed-iam-permissions).

#### Request IDs

Successful responses from Claude Models on Google Cloud (Anthropic managed) carry the [`request-id`](https://platform.claude.com/docs/en/api/errors#request-id) header.

## Moving from an existing Anthropic organization

You can’t convert an existing Anthropic organization into an organization for Claude Models on Google Cloud (Anthropic managed). That includes an organization you use with the Claude API directly.

Plan the move as a cutover to a new organization:

* **Create the new organization first.** Follow [Set up your account](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed#set-up-your-account).
* **Recreate access and configuration.** API keys, workspaces, and Claude Console settings don’t carry over. Grant [IAM roles](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed#iam-roles) on the project instead of creating API keys. To recreate your workspaces, see [Workspaces](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed#workspaces). For ZDR arrangements, see [Data retention](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed#data-retention).
* **Plan for stored resources.** Files, skills, batches, and Claude Managed Agents resources stay in the existing organization.
* **Update your integration.** For what changes and what stays the same, see [Making requests](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed#making-requests). For features that aren’t supported, see [Features not supported](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed#features-not-supported).
* **Cut over on your own schedule.** The two organizations are independent and can serve traffic in parallel. You can move workloads gradually. The existing organization keeps its current billing. Before you shift production traffic, check the [rate limits for Claude Models on Google Cloud (Anthropic managed)](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed#rate-limits).

## Migrating from Claude Models on Google Cloud (Google managed)

To move to Claude Models on Google Cloud (Anthropic managed), complete the following steps. Before you move workloads that rely on a ZDR arrangement, see [Data retention](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed#data-retention). For what changes when you move, see [How the two Google Cloud offerings differ](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/overview#how-the-two-google-cloud-offerings-differ).

<Steps>
  <Step title="Set up your account">
    Complete every step in [Set up your account](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed#set-up-your-account).
  </Step>

  <Step title="Set up access">
    Grant `roles/claude.user` to each identity that calls Claude Models on Google Cloud (Anthropic managed). Set your project and workspace ID as environment variables. For both, see [Before making API calls](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed#before-making-api-calls).
  </Step>

  <Step title="Install the SDK package">
    Install the package that provides the client for Claude Models on Google Cloud (Anthropic managed). See [Install an SDK](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed#install-an-sdk).
  </Step>

  <Step title="Replace the import and the client">
    Change the code that imports and creates your client. Use `AnthropicGoogleCloud` (csharp: `AnthropicGoogleCloudClient`; go: `googlecloud.NewClient()`; java: `GoogleCloudBackend`; php: `Anthropic\GoogleCloud\Client`; ruby: `Anthropic::GoogleCloudClient`) in place of `AnthropicVertex` (csharp: `AnthropicVertexClient`; go: `vertex.WithGoogleAuth()`; java: `VertexBackend`; php: `Anthropic\Vertex\Client`; ruby: `Anthropic::VertexClient`). In a cURL request, change the URL, the headers, and the body. Your current code creates a client for Claude Models on Google Cloud (Google managed). For example, the following code creates that client with the global endpoint:

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

    The following code creates the client for Claude Models on Google Cloud (Anthropic managed):

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

    The new client reads your project and workspace ID from the environment variables you set in [Find your workspace ID](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed#find-your-workspace-id). You don’t pass them when you create the client. Your Messages API calls stay as they are, except for the model IDs and features in the next step.
  </Step>

  <Step title="Check model IDs and features">
    * **Model IDs:** If you use a model earlier than Claude 4.6, replace the `@` before the snapshot date in its ID with a hyphen. For example, `claude-haiku-4-5@20251001` becomes `claude-haiku-4-5-20251001`. For the models and their IDs, see [API model IDs](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed#api-model-ids).
    * **Features:** Check [Feature support](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed#feature-support) for each feature your code uses.
    * **Location:** If you use a multi-region or regional endpoint today, check which location Claude Models on Google Cloud (Anthropic managed) uses. See [Project, location, and workspace resolution](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed#project-location-and-workspace-resolution).
  </Step>

  <Step title="Run a test request">
    Run the request in [Making requests](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed#making-requests) to check that your setup works. Then run your own code. If a call fails with a permission error, see [Troubleshooting account setup](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed#troubleshooting-account-setup). Before you move production traffic, check the [rate limits for Claude Models on Google Cloud (Anthropic managed)](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed#rate-limits).
  </Step>
</Steps>

## Support

[Google Cloud Support](https://cloud.google.com/support) handles your Google Cloud account, access, and billing. [Anthropic Support](https://support.claude.com/en/articles/9015913-how-to-get-support) handles Claude itself, including models, API errors, and rate limits. To request higher rate limits, see [Rate limits](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed#rate-limits).

## Next steps

<CardGroup cols={2}>
  <Card title="Features overview" icon="stack" href="https://platform.claude.com/docs/en/build-with-claude/overview">
    Explore Claude’s features.
  </Card>

  <Card title="IAM permissions" icon="lock" href="https://platform.claude.com/docs/en/api/claude-models-on-google-cloud-anthropic-managed-iam-permissions">
    Look up permissions, roles, and audit log types.
  </Card>

  <Card title="Model deprecations" icon="arrow-clockwise" href="https://platform.claude.com/docs/en/about-claude/model-deprecations">
    As safer and more capable models launch, Anthropic regularly retires older ones. See all API deprecations, along with recommended replacements.
  </Card>

  <Card title="Google Cloud Marketplace" icon="coins" href="https://console.cloud.google.com/marketplace">
    Manage your subscription and billing.
  </Card>
</CardGroup>
