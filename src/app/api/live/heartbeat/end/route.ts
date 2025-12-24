/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

/**
 * 直播心跳结束 API
 *
 * 功能说明：
 * - 当用户离开直播页面时调用，立即结算当前观看会话
 * - 使用 sendBeacon 发送，确保页面关闭时数据不丢失
 * - 作为心跳超时机制的补充，提高数据准确性
 */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { db } from '@/lib/db';
import { LiveWatchSession, LiveWatchState } from '@/lib/types';

export const runtime = 'nodejs';

// 心跳间隔时间（秒），用于计算观看时长
const HEARTBEAT_INTERVAL = 30;

// 最大单次观看时长（秒），防止异常数据
const MAX_SESSION_DURATION = 8 * 60 * 60; // 8小时

// 最小有效观看时长（秒），过滤无效数据
const MIN_SESSION_DURATION = 30; // 至少1次心跳

/**
 * 结算观看会话
 * 当用户离开时，计算并保存观看记录
 *
 * @param username - 用户名
 * @param state - 观看状态
 * @param endTime - 结束时间戳
 */
async function settleWatchSession(
  username: string,
  state: LiveWatchState,
  endTime: number
): Promise<void> {
  // 基于心跳次数计算时长，更准确
  const duration = state.heartbeatCount * HEARTBEAT_INTERVAL;

  // 过滤无效数据
  if (duration < MIN_SESSION_DURATION) {
    console.log(`[LiveStats] 观看时长过短，跳过记录: ${duration}秒`);
    return;
  }

  if (duration > MAX_SESSION_DURATION) {
    console.log(`[LiveStats] 观看时长异常，跳过记录: ${duration}秒`);
    return;
  }

  // 构建会话记录
  const session: LiveWatchSession = {
    channelId: state.channelId,
    channelName: state.channelName,
    channelGroup: state.channelGroup,
    channelLogo: state.channelLogo,
    sourceKey: state.sourceKey,
    sourceName: state.sourceName,
    startTime: state.startTime,
    endTime,
    duration,
    heartbeatCount: state.heartbeatCount,
  };

  try {
    // 获取现有会话列表
    const sessionsKey = `live:sessions:${username}`;
    const existingSessions = await db.getCache(sessionsKey) || [];

    // 添加新会话到列表头部
    existingSessions.unshift(session);

    // 只���留最近100条记录
    if (existingSessions.length > 100) {
      existingSessions.length = 100;
    }

    // 保存会话列表
    await db.setCache(sessionsKey, existingSessions);

    // 更新用户统计汇总
    const statsKey = `live:stats:${username}`;
    const stats = await db.getCache(statsKey) || {
      totalWatchTime: 0,
      totalSessions: 0,
      lastWatchTime: 0,
    };

    stats.totalWatchTime += duration;
    stats.totalSessions += 1;
    stats.lastWatchTime = endTime;

    await db.setCache(statsKey, stats);

    // 更新每日统计
    const today = new Date().toISOString().split('T')[0];
    const dailyKey = `live:daily:${today}`;
    const dailyStats = await db.getCache(dailyKey) || {
      watchTime: 0,
      sessions: 0,
      users: [],
    };

    dailyStats.watchTime += duration;
    dailyStats.sessions += 1;
    if (!dailyStats.users.includes(username)) {
      dailyStats.users.push(username);
    }

    // 每日统计保留7天
    await db.setCache(dailyKey, dailyStats, 7 * 24 * 60 * 60);

    // 更新频道统计
    const channelStatsKey = `live:channel:${state.channelId}`;
    const channelStats = await db.getCache(channelStatsKey) || {
      channelId: state.channelId,
      channelName: state.channelName,
      channelGroup: state.channelGroup,
      totalWatchTime: 0,
      totalSessions: 0,
      users: [],
    };

    channelStats.totalWatchTime += duration;
    channelStats.totalSessions += 1;
    if (!channelStats.users.includes(username)) {
      channelStats.users.push(username);
    }

    await db.setCache(channelStatsKey, channelStats);

    console.log(`[LiveStats] 会话结算成功(end): ${username} 观看 ${state.channelName} ${duration}秒`);
  } catch (error) {
    console.error('[LiveStats] 结算会话失败:', error);
  }
}

/**
 * POST /api/live/heartbeat/end
 * 处理心跳结束请求（用户离开直播页面时调用）
 */
export async function POST(request: NextRequest) {
  // 检查存储类型
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return NextResponse.json(
      { error: '本地存储模式不支持直播统计' },
      { status: 400 }
    );
  }

  // 验证用户身份
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const username = authInfo.username;

  try {
    // 解析请求参数
    const body = await request.json();
    const { sessionId } = body;

    // 参数验证
    if (!sessionId) {
      return NextResponse.json(
        { error: '缺少 sessionId 参数' },
        { status: 400 }
      );
    }

    const now = Date.now();
    const watchKey = `live:watching:${username}:${sessionId}`;

    // 获取当前观看状态
    const state: LiveWatchState | null = await db.getCache(watchKey);

    if (state) {
      // 结算观看会话
      await settleWatchSession(username, state, now);

      // 删除观看状态
      await db.deleteCache(watchKey);

      console.log(`[LiveStats] 会话已结束: ${username} sessionId=${sessionId}`);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[LiveStats] 结束心跳处理失败:', error);
    return NextResponse.json(
      { error: '处理失败', details: (error as Error).message },
      { status: 500 }
    );
  }
}
