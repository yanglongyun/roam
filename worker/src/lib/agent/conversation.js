import { inject } from 'vue';

export const conversationKey = Symbol('conversation');

export function useConversation() {
    const conversation = inject(conversationKey);
    if (!conversation) throw new Error('对话组件需要由 ConversationPane 提供会话');
    return conversation;
}
