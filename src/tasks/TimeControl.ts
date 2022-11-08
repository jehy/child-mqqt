import dayjs from 'dayjs';
import pTimeout from 'p-timeout';

import Task from './Task';
import isWin from '../lib/isWin';
import execAsync from '../lib/execAsync';

import type { TaskOptions, TaskType } from './Task';

export type TimeControlConfig = {
  allowedTime: Array<{ start: number, end: number }>,
  topicShutdown: string,
  topicDelay: string,
  topicForceOff: string,
  onlineOnly: boolean,
  debug: boolean,
};

export default class TimeControl extends Task {
  public name:TaskType = 'TimeControl';

  public config: TimeControlConfig;

  public delay: boolean;

  public forceOff: boolean;

  constructor(config: any, options: TaskOptions) {
    super(options);
    this.config = config;

    if (!this.config.topicDelay) {
      this.enabled = false;
      this.logs.push('topicDelay topic not found');
    }
    if (!this.config.topicForceOff) {
      this.enabled = false;
      this.logs.push('topicForceOff topic not found');
    }
    if (!this.config.topicShutdown) {
      this.enabled = false;
      this.logs.push('topicShutdown topic not found');
    }
    if (!this.config.allowedTime) {
      this.enabled = false;
      this.logs.push('allowedTime not found');
    }
  }

  public shutdown(debug: boolean = false) {
    if (debug) {
      console.log('SHUTDOWN debug');
      return;
    }
    if (isWin) {
      execAsync('shutdown /s /t 3').catch((err) => {
        this.logs.push(err.message + err.stack);
      });
    } else {
      execAsync('shutdown now').catch((err) => {
        this.logs.push(err.message + err.stack);
      });
    }
  }

  public async waitForTopic(waitTopic: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.client.on('message', (topic, message) => {
        if (topic !== waitTopic) {
          return;
        }
        if (message.toString() === '1') {
          resolve(true);
          return;
        }
        resolve(false);
      });
    });
  }

  public async start(): Promise<void> {
    const res = Promise.all([
      pTimeout(this.waitForTopic(this.config.topicDelay), 10_000, () => false),
      pTimeout(this.waitForTopic(this.config.topicForceOff), 10_000, () => false),
    ]);
    await pTimeout(Promise.all([
      this.client.subscribe(this.config.topicDelay),
      this.client.subscribe(this.config.topicForceOff),
    ]), 10_000, () => null);
    [this.delay, this.forceOff] = await res;
  }

  public async end(): Promise<void> {
    let shouldShutdown = false;
    if (this.forceOff) {
      this.logs.push('shutdown: force mode');
      shouldShutdown = true;
    }
    const time = parseInt(dayjs().format('HH'), 10);
    console.log(`Current time ${time}`);
    const allowedTime = this.config.allowedTime as Array<{ start: number, end: number }>;
    const allowed = allowedTime.find((interval) => interval.start < time && time < interval.end);
    if (!allowed && !this.delay) {
      this.logs.push('shutdown: not allowed time');
      shouldShutdown = true;
    }
    if (this.config.onlineOnly && !this.client.connected) {
      this.logs.push('shutdown: should work online only');
      shouldShutdown = true;
    }
    if (shouldShutdown) {
      setTimeout(() => this.shutdown(this.config.debug), 1000);
      await this.client.publish(this.config.topicShutdown, '1');
    }
  }
}
