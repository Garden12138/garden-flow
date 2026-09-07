# First creation: introduce GardenFlow with GardenFlow

[Home](../README_EN.md) · [简体中文](./FIRST_CREATION.md) · [Demo and verification](./DEMO.md)

Create a saved introduction with inspectable sources. A cover is optional. This tutorial needs a text model; it does not require a browser extension, embeddings, or a video model. The sample material and prompts are in Chinese for the initial creator audience.

## Install and configure

Download from [Releases](https://github.com/Garden12138/garden-flow/releases/latest): arm64 DMG for Apple Silicon, x64 DMG for Intel Macs, x64 exe for Windows, or x64 AppImage/deb for Linux. Current packages are unsigned and not Apple-notarized; see [packaging and verification](./PACKAGING.md).

GardenFlow uses a [non-commercial source-available license](../LICENSE). Bring your own model credentials or a running local compatible service. There is no shared API key or included model balance. External providers receive the inputs you send to them and may charge for requests.

In **Settings → General** (`设置 → 通用`), confirm your workspace. In **Settings → AI Providers** (`AI 供应商`), add a provider, choose its preset, and enter Endpoint, API Key and model. A local endpoint may use an empty key. Set the chat/creation capability route to **Custom** (`自定义`), select the provider and model, and save. Validate with a simple text request. A complete configuration is not proof of a successful provider connection. Tool-based creation also requires a model that supports tools.

## Import, choose an angle, and write

1. Download [gardenflow-facts.md](../examples/first-creation/sources/gardenflow-facts.md) using GitHub's raw-file download. Alternatively, take `examples/first-creation/` from the repository ZIP; Node.js is unnecessary.
2. In the knowledge library, use **Add files** (`添加文件`). Inspect the imported material and its source links. Without embeddings, use full-text search or select the source explicitly.
3. In AI creation, attach the source through `#` or the source selector. Send the [topic prompt](../examples/first-creation/prompts.md), review the three candidates and choose the introduction workflow angle. This uses the creation conversation without requiring a separate ideation model.
4. Send the writing prompt. Check capabilities, links, license wording and provider requirements. Do not invent user counts, performance claims, or actions that were not performed.
5. Ask to save the checked draft and review any write confirmation. Open it from the manuscripts page and verify its text and references. If the model only returns chat text, manually create a manuscript and record that manual step.

The minimum success condition is a saved, editable introduction whose sources can be inspected. A chat message saying “saved” is insufficient evidence.

For comparison, see the [reviewed introduction from the recorded run](../examples/first-creation/output/gardenflow-intro.md). Exact wording may differ; the factual and source boundaries should remain consistent.

## Optional cover

Configure the image route separately under AI Providers with an image-capable provider and model. Use the cover prompt, then inspect the actual image in the media library and locate its file. Correct any text errors before publishing. If image configuration is missing or the job fails, keep the completed text draft and troubleshoot the image service separately.

The [actual 3:4 cover from this run](../examples/first-creation/output/gardenflow-first-creation-cover.png) was saved by GardenFlow and copied from the isolated media library. The model, dimensions, and timing are recorded in [Demo and verification](./DEMO.md).

## Optional browser capture

In **Settings → Privacy and diagnostics → Browser extension** (`设置 → 隐私与诊断 → 浏览器插件`), click **Prepare extension** (`准备插件`), then **Open extension folder** (`打开插件目录`). Enable developer mode in Chrome/Edge/Brave and load that unpacked directory. Keep GardenFlow open and verify the connected state. “Prepared” and “connected” are different states. Release users do not need to build the extension from source.

## Recovery and feedback

- No text model: configure and save the chat route; local material management still works.
- Provider request fails: check protocol, endpoint, model, network and provider quota with a minimal text request.
- No image model: complete the text workflow first.
- Extension disconnected: prepare it, load the exported directory and inspect the connection; local-file import does not require it.
- No saved output: inspect the actual task and file result, not only the assistant's reply.

Ask usage questions in [Discussions](https://github.com/Garden12138/garden-flow/discussions) or report reproducible problems through the [bug form](https://github.com/Garden12138/garden-flow/issues/new?template=bug_report.yml). Include version, OS, tutorial step and expected/actual behavior; omit credentials and private material.
