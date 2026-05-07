import { normalizeLlmPayload } from './input/index.js';
import { parseRegularResponse } from './output/regular.js';
import { parseStreamResponse } from './output/stream.js';
import { providers } from './providers.js';

function resolveLlmProvider({ provider, apiUrl, model } = {}) {
    const config = {
        provider: String(provider || '').trim(),
        apiUrl: String(apiUrl || '').trim(),
        model: String(model || '').trim(),
    };

    return providers.find((item) => item.match?.(config)) ||
        providers.find((item) => item.id === config.provider) ||
        providers.find((item) => item.id === 'openai');
}

function resolveLlmPipeline(config = {}) {
    const provider = resolveLlmProvider(config);
    return {
        provider,
        requester: provider.pipeline.requester,
        input: provider.pipeline.input,
        output: provider.pipeline.output,
        capabilities: provider.capabilities,
    };
}

async function callLlmRegular(apiUrl, apiKey, payload, { provider, signal } = {}) {
    const pipeline = resolveLlmPipeline({ provider, apiUrl, model: payload?.model });
    const llmPayload = normalizeLlmPayload(payload, pipeline.input);
    const res = await fetch(
        apiUrl || pipeline.provider.apiUrl,
        pipeline.requester.buildRegularRequest({
            apiKey,
            apiUrl: apiUrl || pipeline.provider.apiUrl,
            payload: llmPayload,
            signal,
        })
    );
    return parseRegularResponse(res);
}

async function callLlmStream(apiUrl, apiKey, payload, { provider, signal, onDelta } = {}) {
    const pipeline = resolveLlmPipeline({ provider, apiUrl, model: payload?.model });
    const llmPayload = normalizeLlmPayload(payload, pipeline.input);
    const res = await fetch(
        apiUrl || pipeline.provider.apiUrl,
        pipeline.requester.buildStreamRequest({
            apiKey,
            apiUrl: apiUrl || pipeline.provider.apiUrl,
            payload: llmPayload,
            signal,
        })
    );
    return parseStreamResponse(res, pipeline.output, onDelta);
}

export { callLlmRegular, callLlmStream, resolveLlmPipeline, resolveLlmProvider };
export default {
    callLlmRegular,
    callLlmStream,
    resolveLlmPipeline,
    resolveLlmProvider,
};