/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

/**
 * 直播统计查询 API
 *
 * 功能说明：
 * - 仅管理员可访问
 * - 返回全站直播观看统计数据
 * - 包含用户统计、热门频道、每日趋势等
 */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { GlobalLiveStats, LiveWatchSession, UserLiveStats } from '@/lib/types';

export const runtime = 'nodejs';

// 统计结果缓存时间（秒）
const STATS_CACHE_TTL = 5 * 60; // 5分钟

/**
 * GET /api/admin/live-stats
 * 获取全站直播统计数据
 */
export async function GET(request: NextRequest) {
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
    // 验证管理员权限
    const config = await getConfig();
    let isAdmin = false;

    if (username === process.env.USERNAME) {
      isAdmin = true;
    } else {
      const userEntry = config.UserConfig.Users.find(
        (u) => u.username === username
      );
      if (userEntry && userEntry.role === 'admin' && !userEntry.banned) {
        isAdmin = true;
      }
    }

    if (!isAdmin) {
      return NextResponse.json({ error: '权限不足' }, { status: 403 });
    }

    // 检查是否需要强制刷新
    const forceRefresh = request.nextUrl.searchParams.get('refresh') === 'true';

    // 尝试从缓存获取
    const cacheKey = 'live:global-stats';
    if (!forceRefresh) {
      const cachedStats = await db.getCache(cacheKey);
      if (cachedStats) {
        return NextResponse.json(cachedStats);
      }
    }

    // 获取所有用户列表
    const allUsers = config.UserConfig.Users;
    const userStats: UserLiveStats[] = [];
    let totalWatchTime = 0;
    let totalSessions = 0;
    const channelStatsMap: Map<string, {
      channelId: string;
      channelName: string;
      channelGroup: string;
      totalWatchTime: number;
      totalSessions: number;
      users: Set<string>;
    }> = new Map();

    // 遍历所有用户，收集直播统计数据
    for (const user of allUsers) {
      try {
        // 获取用户直播统计
        const statsKey = `live:stats:${user.username}`;
        const stats = await db.getCache(statsKey);

        // 获取用户观看会话记录
        const sessionsKey = `live:sessions:${user.username}`;
        const sessions: LiveWatchSession[] = await db.getCache(sessionsKey) || [];

        if (!stats && sessions.length === 0) {
          continue; // 跳过没有直播观看记录的用户
        }

        // 计算用户最常看的频道
        const channelWatchMap: Map<string, {
          channelId: string;
          channelName: string;
          channelGroup: string;
          watchTime: number;
          watchCount: number;
        }> = new Map();

        for (const session of sessions) {
          const existing = channelWatchMap.get(session.channelId);
          if (existing) {
            existing.watchTime += session.duration;
            existing.watchCount += 1;
          } else {
            channelWatchMap.set(session.channelId, {
              channelId: session.channelId,
              channelName: session.channelName,
              channelGroup: session.channelGroup,
              watchTime: session.duration,
              watchCount: 1,
            });
          }

          // 更新全站频道统计
          const globalChannel = channelStatsMap.get(session.channelId);
          if (globalChannel) {
            globalChannel.totalWatchTime += session.duration;
            globalChannel.totalSessions += 1;
            globalChannel.users.add(user.username);
          } else {
            channelStatsMap.set(session.channelId, {
              channelId: session.channelId,
              channelName: session.channelName,
              channelGroup: session.channelGroup,
              totalWatchTime: session.duration,
              totalSessions: 1,
              users: new Set([user.username]),
            });
          }
        }

        // 按观看时长排序，取前5个频道
        const favoriteChannels = Array.from(channelWatchMap.values())
          .sort((a, b) => b.watchTime - a.watchTime)
          .slice(0, 5);

        // 构建用户统计
        const userStat: UserLiveStats = {
          username: user.username,
          totalWatchTime: stats?.totalWatchTime || 0,
          totalSessions: stats?.totalSessions || 0,
          lastWatchTime: stats?.lastWatchTime || 0,
          favoriteChannels,
          recentSessions: sessions.slice(0, 10), // 最近10条记录
        };

        userStats.push(userStat);

        // 累计全站统计
        totalWatchTime += userStat.totalWatchTime;
        totalSessions += userStat.totalSessions;
      } catch (error) {
        console.error(`[LiveStats] 获取用户 ${user.username} 统计失败:`, error);
      }
    }

    // 按观看时长排序用户
    userStats.sort((a, b) => b.totalWatchTime - a.totalWatchTime);

    // 构建热门频道排行（前10个）
    const hotChannels = Array.from(channelStatsMap.values())
      .map(channel => ({
        channelId: channel.channelId,
        channelName: channel.channelName,
        channelGroup: channel.channelGroup,
        totalWatchTime: channel.totalWatchTime,
        totalUsers: channel.users.size,
        totalSessions: channel.totalSessions,
      }))
      .sort((a, b) => b.totalWatchTime - a.totalWatchTime)
      .slice(0, 10);

    // 获取近7天趋势数据
    const dailyTrend: Array<{
      date: string;
      watchTime: number;
      sessions: number;
      users: number;
    }> = [];

    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dateKey = date.toISOString().split('T')[0];
      const dailyKey = `live:daily:${dateKey}`;
      const dailyStats = await db.getCache(dailyKey);

      dailyTrend.push({
        date: dateKey,
        watchTime: dailyStats?.watchTime || 0,
        sessions: dailyStats?.sessions || 0,
        users: dailyStats?.users?.length || 0,
      });
    }

    // 计算今日活跃用户数
    const todayKey = now.toISOString().split('T')[0];
    const todayDailyKey = `live:daily:${todayKey}`;
    const todayStats = await db.getCache(todayDailyKey);
    const todayActiveUsers = todayStats?.users?.length || 0;

    // 构建最终结果
    const result: GlobalLiveStats = {
      totalUsers: userStats.length,
      totalWatchTime,
      totalSessions,
      todayActiveUsers,
      hotChannels,
      dailyTrend,
      userStats,
    };

    // 缓存结果
    await db.setCache(cacheKey, result, STATS_CACHE_TTL);

    return NextResponse.json(result);
  } catch (error) {
    console.error('[LiveStats] 获取统计数据失败:', error);
    return NextResponse.json(
      { error: '获取统计数据失败', details: (error as Error).message },
      { status: 500 }
    );
  }
}
