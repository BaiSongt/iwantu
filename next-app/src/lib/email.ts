/**
 * Email Integration
 *
 * Email sending via nodemailer with SMTP configuration from environment
 * variables. Provides generic send plus typed templates for proposal
 * notifications and welcome emails.
 *
 * Env vars: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM
 */

import nodemailer from 'nodemailer';

// ---------------------------------------------------------------------------
// Transporter
// ---------------------------------------------------------------------------

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.example.com',
  port: Number(process.env.SMTP_PORT) || 587,
  secure: Number(process.env.SMTP_PORT) === 465,
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  },
});

const EMAIL_FROM = process.env.EMAIL_FROM || 'iWantU <noreply@iwantu.com>';

// ---------------------------------------------------------------------------
// Generic send
// ---------------------------------------------------------------------------

/**
 * Send an HTML email. Logs errors gracefully without throwing.
 */
export async function sendEmail(
  to: string,
  subject: string,
  html: string,
): Promise<boolean> {
  try {
    await transporter.sendMail({
      from: EMAIL_FROM,
      to,
      subject,
      html,
    });
    console.log(`[Email] Sent to ${to}: ${subject}`);
    return true;
  } catch (error) {
    console.error('[Email] sendEmail failed:', error);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Email templates
// ---------------------------------------------------------------------------

function baseHtmlWrapper(body: string): string {
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>iWantU</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.06);">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#155AEF,#7C3AED);padding:24px 32px;">
              <span style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">iWantU</span>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px;color:#1e293b;font-size:15px;line-height:1.7;">
              ${body}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;border-top:1px solid #e2e8f0;text-align:center;color:#94a3b8;font-size:12px;">
              iWantU AI B2B Marketplace — 此邮件由系统自动发送，请勿直接回复。
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Send a proposal notification email.
 */
export async function sendProposalNotification(
  to: string,
  data: {
    supplierName: string;
    proposalTitle: string;
    demandTitle: string;
    link: string;
  },
): Promise<boolean> {
  const html = baseHtmlWrapper(`
    <p style="margin:0 0 16px;">您好，</p>
    <p style="margin:0 0 16px;">
      供应商 <strong>${data.supplierName}</strong> 针对需求「${data.demandTitle}」提交了新方案：
    </p>
    <p style="margin:0 0 24px;font-size:18px;font-weight:600;color:#155AEF;">
      ${data.proposalTitle}
    </p>
    <a href="${data.link}" style="display:inline-block;padding:12px 28px;background:#155AEF;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">
      查看方案详情
    </a>
    <p style="margin:24px 0 0;color:#64748b;font-size:13px;">
      如果按钮无法点击，请复制以下链接到浏览器打开：<br/>
      <a href="${data.link}" style="color:#155AEF;word-break:break-all;">${data.link}</a>
    </p>
  `);

  return sendEmail(to, `[iWantU] 收到新方案 — ${data.proposalTitle}`, html);
}

/**
 * Send a welcome email to a newly registered user.
 */
export async function sendWelcomeEmail(
  to: string,
  name: string,
): Promise<boolean> {
  const html = baseHtmlWrapper(`
    <p style="margin:0 0 16px;">${name}，您好！</p>
    <p style="margin:0 0 16px;">
      欢迎加入 <strong>iWantU</strong> — AI B2B 智能采购平台。
    </p>
    <p style="margin:0 0 24px;">
      您现在可以：
    </p>
    <ul style="margin:0 0 24px;padding-left:20px;color:#475569;">
      <li style="margin-bottom:8px;">浏览和发布 AI 产品</li>
      <li style="margin-bottom:8px;">发布采购需求，获得智能匹配</li>
      <li style="margin-bottom:8px;">与优质供应商对接方案</li>
      <li>发起 POC 测试，验证产品能力</li>
    </ul>
    <a href="${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/dashboard" style="display:inline-block;padding:12px 28px;background:#155AEF;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">
      进入控制台
    </a>
  `);

  return sendEmail(to, '欢迎加入 iWantU', html);
}
