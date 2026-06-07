/**
 * Notification Helper
 *
 * Convenience functions for creating notifications from other parts of the
 * system. Each function maps to a specific business event.
 */

import { createNotification } from '@/lib/db/notifications';

/**
 * Notify a buyer that they received a new proposal.
 */
export async function notifyProposalReceived(
  buyerId: string,
  proposalId: string,
  supplierName: string,
) {
  return createNotification({
    userId: buyerId,
    type: 'proposal_received',
    title: '收到新方案',
    content: `${supplierName} 提交了一份新方案，请查看。`,
    link: `/proposals/${proposalId}`,
  });
}

/**
 * Notify a supplier that their proposal status changed.
 */
export async function notifyProposalStatus(
  supplierId: string,
  proposalId: string,
  status: string,
) {
  const statusLabels: Record<string, string> = {
    reviewed: '已审阅',
    accepted: '已接受',
    rejected: '已拒绝',
  };
  const label = statusLabels[status] || status;

  return createNotification({
    userId: supplierId,
    type: 'proposal_accepted',
    title: '方案状态更新',
    content: `您的方案已${label}，请查看详情。`,
    link: `/proposals/${proposalId}`,
  });
}

/**
 * Notify POC participants about a status change.
 */
export async function notifyPocStatus(
  participantIds: string[],
  pocId: string,
  status: string,
) {
  const statusLabels: Record<string, string> = {
    confirming_requirements: '确认需求中',
    uploading_sample_data: '上传样本数据',
    supplier_testing: '供应商测试中',
    result_review: '结果评审',
    procurement_discussion: '采购讨论',
    completed: '已完成',
    terminated: '已终止',
  };
  const label = statusLabels[status] || status;

  const results = await Promise.allSettled(
    participantIds.map((userId) =>
      createNotification({
        userId,
        type: 'poc_status',
        title: 'POC状态更新',
        content: `POC项目状态已更新为「${label}」，请关注。`,
        link: `/poc/${pocId}`,
      }),
    ),
  );

  return results;
}

/**
 * Notify a user about a new message.
 */
export async function notifyMessage(
  recipientId: string,
  threadId: string,
  senderName: string,
) {
  return createNotification({
    userId: recipientId,
    type: 'message',
    title: '新消息',
    content: `${senderName} 发来了一条新消息。`,
    link: `/messages?thread=${threadId}`,
  });
}

/**
 * Send a system notification to a user.
 */
export async function notifySystem(
  userId: string,
  title: string,
  content: string,
) {
  return createNotification({
    userId,
    type: 'system',
    title,
    content,
  });
}
