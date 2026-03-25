import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import {
  SecurityNotification,
  EmailContent,
} from './types/notification.types';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(private readonly appConfigService: AppConfigService) {}

  async sendSecurityNotification(
    notification: SecurityNotification,
  ): Promise<void> {
    setImmediate(() => {
      this.processNotification(notification).catch((error) => {
        this.logger.warn(
          `Failed to send notification: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    });
  }

  private async processNotification(
    notification: SecurityNotification,
  ): Promise<void> {
    const emailContent = this.buildEmailContent(notification);

    this.logger.log(
      `[NOTIFICATION] ${notification.type} for user ${notification.userId}: ${emailContent.subject}`,
    );

    if (this.appConfigService.emailEnabled) {
      await this.sendEmail(notification.email, emailContent);
    }
  }

  private buildEmailContent(notification: SecurityNotification): EmailContent {
    const timestamp = notification.timestamp.toISOString();
    const locationInfo = notification.country
      ? `Location: ${notification.country}`
      : 'Location: Unknown';
    const ipInfo = notification.ipPrefix
      ? `IP: ${notification.ipPrefix}*`
      : 'IP: Unknown';
    const deviceInfo = notification.userAgent
      ? this.summarizeUserAgent(notification.userAgent)
      : 'Device: Unknown';

    switch (notification.type) {
      case 'new_session':
        return {
          subject: 'New sign-in to your account',
          body: `
A new sign-in was detected on your account.

${locationInfo}
${ipInfo}
${deviceInfo}
Time: ${timestamp}

If this was you, you can ignore this email.
If you didn't sign in, please secure your account immediately.
          `.trim(),
        };

      case 'suspicious_activity':
        return {
          subject: 'Suspicious activity detected on your account',
          body: `
We detected suspicious activity on your account.

${locationInfo}
${ipInfo}
${deviceInfo}
Time: ${timestamp}

Detected signals:
${notification.signals.map((s) => `- ${s}`).join('\n')}

Your session is still active but may require additional verification for sensitive actions.

If this wasn't you, please secure your account immediately.
          `.trim(),
        };

      case 'forced_logout':
        return {
          subject: 'Security alert: Your session was terminated',
          body: `
Your session was terminated due to security concerns.

${locationInfo}
${ipInfo}
${deviceInfo}
Time: ${timestamp}

Reason: ${notification.reason}

Detected signals:
${notification.signals.map((s) => `- ${s}`).join('\n')}

Please sign in again. If you did not attempt to access your account, please change your password immediately.
          `.trim(),
        };
    }
  }

  private summarizeUserAgent(userAgent: string): string {
    const lowerUA = userAgent.toLowerCase();

    let browser = 'Unknown Browser';
    if (lowerUA.includes('chrome') && !lowerUA.includes('edg')) {
      browser = 'Chrome';
    } else if (lowerUA.includes('firefox')) {
      browser = 'Firefox';
    } else if (lowerUA.includes('safari') && !lowerUA.includes('chrome')) {
      browser = 'Safari';
    } else if (lowerUA.includes('edg')) {
      browser = 'Edge';
    }

    let os = 'Unknown OS';
    if (lowerUA.includes('windows')) {
      os = 'Windows';
    } else if (lowerUA.includes('mac')) {
      os = 'macOS';
    } else if (lowerUA.includes('linux')) {
      os = 'Linux';
    } else if (lowerUA.includes('android')) {
      os = 'Android';
    } else if (lowerUA.includes('iphone') || lowerUA.includes('ipad')) {
      os = 'iOS';
    }

    return `Device: ${browser} on ${os}`;
  }

  private async sendEmail(to: string, content: EmailContent): Promise<void> {
    const smtpConfig = this.appConfigService.smtpConfig;
    if (!smtpConfig) {
      this.logger.debug(
        `Email sending skipped (no SMTP config): ${content.subject} to ${to}`,
      );
      return;
    }

    this.logger.log(`Would send email to ${to}: ${content.subject}`);
  }

  formatSignalsForNotification(signals: Record<string, boolean>): string[] {
    const formatted: string[] = [];

    if (signals.impossibleTravel) {
      formatted.push('Impossible travel detected (location change too fast)');
    }
    if (signals.countryChanged) {
      formatted.push('Access from a different country');
    }
    if (signals.userAgentChanged) {
      formatted.push('Different device or browser detected');
    }
    if (signals.rapidRefreshes) {
      formatted.push('Unusual number of token refreshes');
    }
    if (signals.unusualHour) {
      formatted.push('Access during unusual hours (2-5 AM UTC)');
    }
    if (signals.vpnOrProxyDetected) {
      formatted.push('VPN or proxy connection detected');
    }

    return formatted;
  }
}
