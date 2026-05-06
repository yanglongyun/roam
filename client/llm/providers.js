const { openaiNormalizer } = require('./input/normalizers/openai');
const { deepseekNormalizer } = require('./input/normalizers/deepseek');
const { geminiNormalizer } = require('./input/normalizers/gemini');
const { kimiNormalizer } = require('./input/normalizers/kimi');
const { openaiParser } = require('./output/parsers/openai');
const { deepseekParser } = require('./output/parsers/deepseek');
const { geminiParser } = require('./output/parsers/gemini');
const { kimiParser } = require('./output/parsers/kimi');
const { openaiRequester } = require('./requester/openai');
const { claudeRequester } = require('./requester/claude');

const providerGroups = [
    { id: 'default', name: '默认' },
    { id: 'aggregator', name: '聚合平台' },
    { id: 'coding', name: 'Coding Plan' },
    { id: 'custom', name: '自定义' },
];

const openaiPipeline = {
    requester: openaiRequester,
    input: openaiNormalizer,
    output: openaiParser,
};

const deepseekPipeline = {
    requester: openaiRequester,
    input: deepseekNormalizer,
    output: deepseekParser,
};

const kimiPipeline = {
    requester: openaiRequester,
    input: kimiNormalizer,
    output: kimiParser,
};

const geminiPipeline = {
    requester: openaiRequester,
    input: geminiNormalizer,
    output: geminiParser,
};

const claudePipeline = {
    requester: claudeRequester,
    input: openaiNormalizer,
    output: openaiParser,
};

function createProvider({
    id,
    name,
    group = 'default',
    apiUrl,
    defaultModel,
    keyUrl,
    pipeline = openaiPipeline,
    match = null,
    capabilities = {},
}) {
    return {
        id,
        name,
        group,
        apiUrl,
        defaultModel,
        keyUrl,
        pipeline,
        match,
        capabilities: {
            openaiCompatible: true,
            stream: true,
            tools: true,
            ...capabilities,
        },
    };
}

const providers = [
    createProvider({
        id: 'openai',
        name: 'OpenAI',
        apiUrl: 'https://api.openai.com/v1/chat/completions',
        defaultModel: 'gpt-5.5',
        keyUrl: 'https://platform.openai.com/api-keys',
        match: ({ provider, apiUrl }) => provider === 'openai' || String(apiUrl || '').includes('api.openai.com'),
    }),
    createProvider({
        id: 'claude',
        name: 'Claude',
        apiUrl: 'https://api.anthropic.com/v1/messages',
        defaultModel: 'claude-sonnet-4-6',
        keyUrl: 'https://platform.claude.com/settings/keys',
        pipeline: claudePipeline,
        capabilities: { openaiCompatible: false },
    }),
    createProvider({
        id: 'gemini',
        name: 'Gemini',
        apiUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
        defaultModel: 'gemini-3-flash-preview',
        keyUrl: 'https://aistudio.google.com/apikey',
        pipeline: geminiPipeline,
        match: ({ provider, apiUrl }) => provider === 'gemini' || String(apiUrl || '').includes('generativelanguage.googleapis.com'),
    }),
    createProvider({
        id: 'mistral',
        name: 'Mistral',
        apiUrl: 'https://api.mistral.ai/v1/chat/completions',
        defaultModel: 'mistral-large-latest',
        keyUrl: 'https://console.mistral.ai/api-keys',
    }),
    createProvider({
        id: 'xai',
        name: 'xAI (Grok)',
        apiUrl: 'https://api.x.ai/v1/chat/completions',
        defaultModel: 'grok-4-1-fast-reasoning',
        keyUrl: 'https://console.x.ai/team/default/api-keys',
    }),
    createProvider({
        id: 'deepseek',
        name: 'DeepSeek',
        apiUrl: 'https://api.deepseek.com/chat/completions',
        defaultModel: 'deepseek-v4-flash',
        keyUrl: 'https://platform.deepseek.com/api_keys',
        pipeline: deepseekPipeline,
        match: ({ provider, apiUrl, model }) => provider === 'deepseek' || String(apiUrl || '').includes('api.deepseek.com') || String(model || '').startsWith('deepseek-'),
        capabilities: {
            reasoningContent: true,
            reasoningContentRequiredOnToolCalls: true,
        },
    }),
    createProvider({
        id: 'qwen',
        name: 'Qwen (通义千问)',
        apiUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
        defaultModel: 'qwen3.6-plus',
        keyUrl: 'https://bailian.console.aliyun.com/?tab=model#/api-key',
    }),
    createProvider({
        id: 'glm',
        name: 'GLM (智谱)',
        apiUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
        defaultModel: 'glm-5',
        keyUrl: 'https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys',
    }),
    createProvider({
        id: 'zai',
        name: 'Z.ai',
        apiUrl: 'https://api.z.ai/api/paas/v4/chat/completions',
        defaultModel: 'glm-5',
        keyUrl: 'https://z.ai/manage-apikey/apikey-list',
    }),
    createProvider({
        id: 'kimi',
        name: 'Kimi (月之暗面)',
        apiUrl: 'https://api.moonshot.cn/v1/chat/completions',
        defaultModel: 'kimi-2.6',
        keyUrl: 'https://platform.moonshot.cn/console/api-keys',
        pipeline: kimiPipeline,
        match: ({ provider, apiUrl }) => provider === 'kimi' || String(apiUrl || '').includes('moonshot.cn') || String(apiUrl || '').includes('kimi.com'),
        capabilities: {
            reasoningContent: true,
        },
    }),
    createProvider({
        id: 'stepfun',
        name: 'StepFun (阶跃星辰)',
        apiUrl: 'https://api.stepfun.com/v1/chat/completions',
        defaultModel: 'step-3.5-flash',
        keyUrl: 'https://platform.stepfun.com/interface-key',
    }),
    createProvider({
        id: 'minimax',
        name: 'MiniMax',
        apiUrl: 'https://api.minimaxi.com/v1/chat/completions',
        defaultModel: 'MiniMax-M2.7',
        keyUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
    }),
    createProvider({
        id: 'doubao',
        name: 'Doubao (豆包)',
        apiUrl: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
        defaultModel: 'doubao-seed-2-0-pro-260215',
        keyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
    }),
    createProvider({
        id: 'openrouter',
        name: 'OpenRouter',
        group: 'aggregator',
        apiUrl: 'https://openrouter.ai/api/v1/chat/completions',
        defaultModel: 'google/gemini-3-flash-preview',
        keyUrl: 'https://openrouter.ai/keys',
    }),
    createProvider({
        id: 'together',
        name: 'Together AI',
        group: 'aggregator',
        apiUrl: 'https://api.together.xyz/v1/chat/completions',
        defaultModel: 'moonshotai/Kimi-K2.5',
        keyUrl: 'https://api.together.xyz/settings/api-keys',
    }),
    createProvider({
        id: 'fireworks',
        name: 'Fireworks AI',
        group: 'aggregator',
        apiUrl: 'https://api.fireworks.ai/inference/v1/chat/completions',
        defaultModel: 'glm-5',
        keyUrl: 'https://app.fireworks.ai/settings/users/api-keys',
    }),
    createProvider({
        id: 'glm-coding',
        name: '智谱 Coding Plan',
        group: 'coding',
        apiUrl: 'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions',
        defaultModel: 'glm-5',
        keyUrl: 'https://z.ai/manage-apikey/apikey-list',
    }),
    createProvider({
        id: 'aliyun-coding',
        name: '阿里云 Coding Plan',
        group: 'coding',
        apiUrl: 'https://coding.dashscope.aliyuncs.com/v1/chat/completions',
        defaultModel: 'qwen3-coder-plus',
        keyUrl: 'https://bailian.console.aliyun.com/',
    }),
    createProvider({
        id: 'ark-coding',
        name: '火山引擎 Coding Plan',
        group: 'coding',
        apiUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3/chat/completions',
        defaultModel: 'doubao-seed-2.0-pro',
        keyUrl: 'https://console.volcengine.com/ark',
    }),
    createProvider({
        id: 'tencent-coding',
        name: '腾讯云 Coding Plan',
        group: 'coding',
        apiUrl: 'https://api.lkeap.cloud.tencent.com/coding/v3/chat/completions',
        defaultModel: 'minimax-m2.5',
        keyUrl: 'https://console.cloud.tencent.com/lkeap/api',
    }),
    createProvider({
        id: 'jdcloud-coding',
        name: '京东云 Coding Plan',
        group: 'coding',
        apiUrl: 'https://modelservice.jdcloud.com/coding/openai/v1/chat/completions',
        defaultModel: 'Kimi-K2.5',
        keyUrl: 'https://docs.jdcloud.com/cn/jdaip/api-key',
    }),
    createProvider({
        id: 'kimi-coding',
        name: 'Kimi Coding Plan',
        group: 'coding',
        apiUrl: 'https://api.kimi.com/coding/v1/chat/completions',
        defaultModel: 'kimi-for-coding',
        keyUrl: 'https://platform.moonshot.cn/console/api-keys',
        pipeline: kimiPipeline,
        match: ({ provider, apiUrl }) => provider === 'kimi-coding' || String(apiUrl || '').includes('api.kimi.com'),
    }),
    createProvider({
        id: 'custom',
        name: '自定义',
        group: 'custom',
        apiUrl: '',
        defaultModel: '',
        keyUrl: '',
    }),
];

function publicProvider({ pipeline, match, ...provider }) {
    return provider;
}

function getProviderCatalog() {
    return {
        groups: providerGroups,
        providers: providers.map(publicProvider),
    };
}

module.exports = {
    providerGroups,
    providers,
    getProviderCatalog,
};
