import { openaiNormalizer } from './openai.js';

export { openaiNormalizer as geminiNormalizer };
export default {
    geminiNormalizer: openaiNormalizer,
};