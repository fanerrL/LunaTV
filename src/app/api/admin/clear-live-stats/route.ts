/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return NextResponse.json(
      {
        error: '不支持本地存储进行直播统计清理',
      },
      { status: 400 }
    );
  }

  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const config = await getConfig();
    const username = authInfo.username;

    // 判定操作者角色（只有管理员可以清理）
    if (username !== process.env.USERNAME) {
      const userEntry = config.UserConfig.Users.find(
        (u) => u.username === username
      );
      if (!userEntry || userEntry.role !== 'admin' || userEntry.banned) {
        return NextResponse.json({ error: '权限不足' }, { status: 401 });
      }
    }

    const storage = db;

    // 获取所有用户
    const allUsers = config.UserConfig.Users;

    console.log('[清理直播统计] 开始清理所有用户的直播统计数据...');

    let deletedCount = 0;

    // 清理每个用户的直播观看记录
    for (const user of allUsers) {
      const userRecordsKey = `live_views:${user.username}`;
      console.log(
        `[清理直播统计] 清理用户 ${user.username} 的记录，key: ${userRecordsKey}`
      );

      try {
        await storage.deleteDirectKey(userRecordsKey);
        deletedCount++;
      } catch (error) {
        console.error(`[清理直播统计] 清理用户 ${user.username} 失败:`, error);
      }
    }

    console.log(`[清理直播统计] 清理完成，共清理 ${deletedCount} 个用户的记录`);

    return NextResponse.json({
      success: true,
      message: `成功清理 ${deletedCount} 个用户的直播统计数据`,
      deletedCount,
    });
  } catch (error) {
    console.error('[清理直播统计] 清理失败:', error);
    return NextResponse.json(
      {
        error: '清理直播统计失败',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
