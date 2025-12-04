/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { db } from '@/lib/db';
import { LiveViewRecord } from '@/lib/types';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return NextResponse.json(
      {
        error: '不支持本地存储进行直播统计',
      },
      { status: 400 }
    );
  }

  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const {
      channelName,
      channelId,
      sourceName,
      sourceKey,
      startTime,
      endTime,
      channelGroup,
      channelLogo,
    } = body;

    // 验证必填字段
    if (
      !channelName ||
      !channelId ||
      !sourceName ||
      !sourceKey ||
      !startTime ||
      !endTime
    ) {
      return NextResponse.json({ error: '缺少必填字段' }, { status: 400 });
    }

    // 计算观看时长
    const duration = Math.floor((endTime - startTime) / 1000); // 转换为秒

    // 只记录观看时长大于5秒的记录
    if (duration < 5) {
      return NextResponse.json({
        success: true,
        message: '观看时长过短，不记录',
      });
    }

    // 同时保存到用户的直播观看记录列表
    const storage = db;
    const userRecordsKey = `live_views:${authInfo.username}`;
    const existingRecords: LiveViewRecord[] =
      (await storage.getDirectKey(userRecordsKey)) || [];

    // 查找是否有最近的同频道、同直播源的记录（1分钟内）
    // 使用 1 分钟窗口可以合并连续观看的片段，但切换频道后再回来会算新的一次
    const oneMinuteAgo = startTime - 60 * 1000;
    let merged = false;

    for (let i = existingRecords.length - 1; i >= 0; i--) {
      const lastRecord = existingRecords[i];

      // 如果是同一个频道、同一个直播源，且时间间隔在1分钟内，则合并
      if (
        lastRecord.channelId === channelId &&
        lastRecord.sourceKey === sourceKey &&
        lastRecord.endTime >= oneMinuteAgo
      ) {
        console.log(
          `[直播统计] 合并记录: ${channelName} (${sourceName}), 原时长: ${lastRecord.duration}秒, 新增: ${duration}秒`
        );

        // 合并记录：保持原始开始时间，更新结束时间和总时长
        lastRecord.endTime = endTime;
        lastRecord.duration = lastRecord.duration + duration;

        merged = true;
        break;
      }
    }

    // 如果没有找到可以合并的记录，创建新记录
    if (!merged) {
      console.log(
        `[直播统计] 创建新记录: ${channelName} (${sourceName}), 时长: ${duration}秒`
      );

      const record: LiveViewRecord = {
        username: authInfo.username,
        channelName,
        channelId,
        sourceName,
        sourceKey,
        startTime,
        endTime,
        duration,
        channelGroup,
        channelLogo,
      };

      existingRecords.push(record);

      // 只保留最近100条记录
      if (existingRecords.length > 100) {
        existingRecords.splice(0, existingRecords.length - 100);
      }
    }

    await storage.setDirectKey(userRecordsKey, existingRecords);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: '记录直播观看失败',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
