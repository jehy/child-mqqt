import timers from 'timers/promises';
import * as mqtt from 'async-mqtt';
// @ts-ignore
import configModule from 'config';
import pTimeout from 'p-timeout';

import tasks from './tasks';
import { DummyMqttClient } from './DummyMqttClient';

import type { IMQTTAdapter } from './IMQTTAdapter';
import type Task from './tasks/Task';
import type { TasksConfig, TaskType } from './tasks/Task';

type Config = {
  mqtt: {
    options: {
      clientId: string,
      username: string,
      password: string
    },
    url: string,
  }
  tasksConfig: TasksConfig,
  logTopic: string,
};

const config = configModule as unknown as Config;

async function withFallBack(task: Task, fn: Function, logs: Array<string>) {
  try {
    await pTimeout(fn.apply(task), 30_000);
    // @ts-ignore
  } catch (err: Error) {
    logs.push(`${task.name}: ${err.message} ${err.stack}`);
  }
}

async function run() {
  let client: IMQTTAdapter; // AsyncMqttClient;//
  let logs:Array<string> = [];
  try {
    client = await pTimeout(mqtt.connectAsync(config.mqtt.url, config.mqtt.options), 10_000);
  } catch (err) {
    logs.push('MQTT connect failed', (err as Error).toString());
    client = new DummyMqttClient();
  }
  const { tasksConfig } = config;
  const tasksObjects: Array<Task> = Object.entries(tasksConfig).map((el) => {
    const name: TaskType = el[0] as TaskType;
    const taskConfig: any = el[1];
    if (!tasks[name]) {
      logs.push(`Class for ${name} not found!`);
      return false;
    }
    const task = new tasks[name](taskConfig, { client });
    if (!task.enabled && task.logs) {
      logs = logs.concat(task.logs);
    }
    if (!task.enabled) {
      return false;
    }
    return task;
  }).filter((el) => el) as Array<Task>;
  console.log(`${new Date().toString()} running ${tasksObjects.length} tasks`);

  const connection = new Promise((resolve) => {
    if (!client) {
      resolve(false);
      return;
    }
    client.on('connect', () => {
      resolve(true);
    });
    client.on('error', (err) => {
      console.log(`${new Date().toString()} error`, err);
      resolve(false);
    });
  });
  await pTimeout(connection, 10_000, () => null);
  await Promise.all(tasksObjects.map((task) => withFallBack(task, task.start, logs)));
  console.log('ran start');
  await Promise.all(tasksObjects.map((task) => withFallBack(task, task.end, logs)));
  console.log('ran end');
  logs = tasksObjects.reduce((res, task) => res.concat(task.logs), logs);
  if (logs.length) {
    console.log(`${new Date().toString()} ${logs.join('\n')}`);
    await client.publish(config.logTopic, logs.join('\n'));
  }
  await client.end();
  await timers.setTimeout(2000); // wait for may-be-shutdown
}

pTimeout(run(), 55_000)
  .then(() => process.exit(0))
  .catch((err) => { console.log(err); process.exit(1); });
