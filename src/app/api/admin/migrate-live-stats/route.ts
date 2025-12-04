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
        error: '不支持本地存储进行直播统计迁移',
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

    // 判定操作者角色（只有管理员可以迁移）
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

    console.log('[迁移直播统计] 开始迁移所有用户的直播统计数据...');

    let migratedCount = 0;
    let skippedCount = 0;

    // 迁移每个用户的直播观看记录
    for (const user of allUsers) {
      const oldKey = `live_views:${user.username}`;
      const newKey = `live_views:${user.username}`;

      console.log(`[迁移直播统计] 检查用户 ${user.username} 的记录...`);

      try {
        // 从旧位置（cache:live_views:username）读取数据
        const oldData = await storage.getCache(oldKey);

        if (!oldData || (Array.isArray(oldData) && oldData.length === 0)) {
          console.log(`[迁移直播统计] 用户 ${user.username} 没有旧数据，跳过`);
          skippedCount++;
          continue;
        }

        // 检查新位置是否已有数据
        const newData = await storage.getDirectKey(newKey);

        if (newData && Array.isArray(newData) && newData.length > 0) {
          console.log(
            `[迁移直播统计] 用户 ${user.username} 新位置已有数据 (${newData.length} 条)，跳过迁移`
          );
          skippedCount++;
          continue;
        }

        // 迁移数据到新位置（live_views:username，不带 cache: 前缀）
        await storage.setDirectKey(newKey, oldData);

        console.log(
          `[迁移直播统计] ✓ 成功迁移用户 ${user.username} 的数据 (${
            Array.isArray(oldData) ? oldData.length : 0
          } 条记录)`
        );

        migratedCount++;
      } catch (error) {
        console.error(`[迁移直播统计] 迁移用户 ${user.username} 失败:`, error);
      }
    }

    console.log(
      `[迁移直播统计] 迁移完成，成功: ${migratedCount}，跳过: ${skippedCount}`
    );

    return NextResponse.json({
      success: true,
      message: `迁移完成：成功迁移 ${migratedCount} 个用户，跳过 ${skippedCount} 个用户`,
      migratedCount,
      skippedCount,
    });
  } catch (error) {
    console.error('[迁移直播统计] 迁移失败:', error);
    return NextResponse.json(
      {
        error: '迁移直播统计失败',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
