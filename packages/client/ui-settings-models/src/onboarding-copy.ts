/** Durable settings namespace for product-wide GUI onboarding facts. */
export const WELCOME_NOTICE_SETTINGS_NAMESPACE = 'ui-onboarding'

/** Field storing the last welcome notice version the user acknowledged. */
export const WELCOME_NOTICE_ACK_FIELD = 'welcomeNoticeVersion'

/**
 * Bump only when the notice changes materially and every user should see it
 * again. The acknowledgement is compared for exact equality.
 */
export const WELCOME_NOTICE_VERSION = '2026-08-27.desk'

/** The complete editable welcome notice in both supported GUI locales. */
export const WELCOME_NOTICE_COPY = {
  zh: {
    title: '欢迎使用 webfaCe Desk',
    body: '这是 webfaCe Desk 的早期版本，专为您的业务而建。Desk 会阅读并起草邮件、准备报价和文件、进行研究、编写和运行代码，并通过已连接的工具处理工作。任何会产生实际影响的操作（发送、发布、付款、删除或更改线上系统）都会先征得您的同意。\n\n遇到问题或有建议，请通过“连接”页面的联系方式告诉我们，或回复您的欢迎邮件。',
    continueLabel: '开始',
  },
  en: {
    title: 'Welcome to webfaCe Desk',
    body: 'This is an early build of webfaCe Desk, set up for your business. Desk reads and drafts email, prepares quotes and documents, researches, writes and runs code, and works through the tools you connect. Anything that matters — sending, publishing, paying, deleting, or changing a live system — waits for your approval first.\n\nIf something looks wrong or you want it to work differently, use Connections → contact, or reply to your welcome email.',
    continueLabel: 'Get started',
  },
} as const
