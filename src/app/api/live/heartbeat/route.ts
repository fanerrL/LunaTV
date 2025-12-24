/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

/**
 * 直播心跳上报 API
 *
 * 功能说明：
 * - 客户端每30秒发送一次心跳，用于追踪用户观看直播的行为
 * - 基于心跳次数计算观看时长，比离开时上报更准确
 * - 支持多标签页场景，通过 sessionId 区分
 *
 * Redis 存储结构：
 * - live:watching:{username}:{sessionId} - 用户当前观看状态 (TTL 60秒)
 * - u:{username}:live:sessions - 用户观看会话记录列表
 * - u:{username}:live:stats - 用户直播统计汇总
 * - live:daily:{YYYY-MM-DD} - 每日统计数据
 */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { db } from '@/lib/db';
import { LiveHeartbeatRequest, LiveWatchSession, LiveWatchState } from '@/lib/types';

export const runtime = 'nodejs';

// 心跳间隔时间（秒），用于计算观看时长
const HEARTBEAT_INTERVAL = 30;

// 观看状态过期时间（秒），超过此时间没有心跳则认为已离开
const WATCH_STATE_TTL = 60;

// 最大单次观看时长（秒），防止异常数据
const MAX_SESSION_DURATION = 8 * 60 * 60; // 8小时

// 最小有效观看时长（秒），过滤无效数据
const MIN_SESSION_DURATION = 30; // 至少1次心跳

/**
 * 结算观看会话
 * 当用户切换频道或离开时，计算并保存观看记录
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

    // 只保留最近100条记录
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

    console.log(`[LiveStats] 会话结算成功: ${username} 观看 ${state.channelName} ${duration}秒`);
  } catch (error) {
    console.error('[LiveStats] 结算会话失败:', error);
  }
}

/**
 * POST /api/live/heartbeat
 * 处理心跳上报请求
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
    const body: LiveHeartbeatRequest = await request.json();
    const {
      sessionId,
      channelId,
      channelName,
      channelGroup,
      channelLogo,
      sourceKey,
      sourceName,
    } = body;

    // 参数验证
    if (!sessionId || !channelId || !channelName || !sourceKey) {
      return NextResponse.json(
        { error: '缺少必要参数' },
        { status: 400 }
      );
    }

    const now = Date.now();
    const watchKey = `live:watching:${username}:${sessionId}`;

    // 获取上次心跳状态
    const lastState: LiveWatchState | null = await db.getCache(watchKey);

    if (lastState) {
      // 如果切换了频道，结算上一个频道的观看时长
      if (lastState.channelId !== channelId) {
        await settleWatchSession(username, lastState, now);

        // 创建新的观看状态
        const newState: LiveWatchState = {
          channelId,
          channelName,
          channelGroup,
          channelLogo,
          sourceKey,
          sourceName,
          startTime: now,
          lastHeartbeat: now,
          heartbeatCount: 1,
        };

        await db.setCache(watchKey, newState, WATCH_STATE_TTL);
      } else {
        // 同一频道，更新心跳
        const updatedState: LiveWatchState = {
          ...lastState,
          lastHeartbeat: now,
          heartbeatCount: lastState.heartbeatCount + 1,
        };

        await db.setCache(watchKey, updatedState, WATCH_STATE_TTL);
      }
    } else {
      // 首次心跳，创建新的观看状态
      const newState: LiveWatchState = {
        channelId,
        channelName,
        channelGroup,
        channelLogo,
        sourceKey,
        sourceName,
        startTime: now,
        lastHeartbeat: now,
        heartbeatCount: 1,
      };

      await db.setCache(watchKey, newState, WATCH_STATE_TTL);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[LiveStats] 心跳处理失败:', error);
    return NextResponse.json(
      { error: '心跳处理失败', details: (error as Error).message },
      { status: 500 }
    );
  }
}
