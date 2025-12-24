/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

'use client';

import { useEffect, useState } from 'react';

import {
  ArrowLeft,
  BarChart3,
  Clock,
  Radio,
  RefreshCw,
  TrendingUp,
  Tv,
  Users,
} from 'lucide-react';
import Link from 'next/link';

import PageLayout from '@/components/PageLayout';
import { GlobalLiveStats, UserLiveStats } from '@/lib/types';

/**
 * 直播统计管理页面
 *
 * 功能说明：
 * - 展示全站直播观看统计数据
 * - 包含用户统计、热门频道、每日趋势等
 * - 仅管理员可访问
 */

/**
 * 格式化时长显示
 * @param seconds - 秒数
 * @returns 格式化后的时长字符串
 */
function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}秒`;
  }
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return secs > 0 ? `${minutes}分${secs}秒` : `${minutes}分钟`;
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return minutes > 0 ? `${hours}小时${minutes}分` : `${hours}小时`;
}

/**
 * 格式化日期显示
 * @param timestamp - 时间戳
 * @returns 格式化后的日期字符串
 */
function formatDate(timestamp: number): string {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * 统计卡片组件
 */
function StatCard({
  title,
  value,
  icon: Icon,
  color,
}: {
  title: string;
  value: string | number;
  icon: any;
  color: string;
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500 dark:text-gray-400">{title}</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">
            {value}
          </p>
        </div>
        <div className={`p-3 rounded-full ${color}`}>
          <Icon className="w-6 h-6 text-white" />
        </div>
      </div>
    </div>
  );
}

/**
 * 趋势图表组件（简单柱状图）
 */
function TrendChart({
  data,
  title,
}: {
  data: Array<{ date: string; watchTime: number; sessions: number; users: number }>;
  title: string;
}) {
  const maxWatchTime = Math.max(...data.map((d) => d.watchTime), 1);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
        {title}
      </h3>
      <div className="flex items-end justify-between h-40 gap-2">
        {data.map((item, index) => {
          const height = (item.watchTime / maxWatchTime) * 100;
          const dayLabel = item.date.slice(5); // MM-DD
          return (
            <div key={index} className="flex-1 flex flex-col items-center">
              <div className="w-full flex flex-col items-center justify-end h-32">
                <div
                  className="w-full bg-gradient-to-t from-blue-500 to-blue-400 rounded-t-sm transition-all duration-300 hover:from-blue-600 hover:to-blue-500"
                  style={{ height: `${Math.max(height, 2)}%` }}
                  title={`观看时长: ${formatDuration(item.watchTime)}\n观看次数: ${item.sessions}\n活跃用户: ${item.users}`}
                />
              </div>
              <span className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                {dayLabel}
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex justify-center gap-6 mt-4 text-xs text-gray-500 dark:text-gray-400">
        <span>📊 观看时长</span>
      </div>
    </div>
  );
}

/**
 * 热门频道排行组件
 */
function HotChannelsTable({
  channels,
}: {
  channels: GlobalLiveStats['hotChannels'];
}) {
  if (!channels || channels.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
          热门频道排行
        </h3>
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          <Tv className="w-12 h-12 mx-auto mb-2 opacity-50" />
          <p>暂无数据</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
        热门频道排行
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-left text-sm text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
              <th className="pb-3 font-medium">排名</th>
              <th className="pb-3 font-medium">频道名称</th>
              <th className="pb-3 font-medium">分组</th>
              <th className="pb-3 font-medium text-right">观看时长</th>
              <th className="pb-3 font-medium text-right">观看次数</th>
              <th className="pb-3 font-medium text-right">用户数</th>
            </tr>
          </thead>
          <tbody>
            {channels.map((channel, index) => (
              <tr
                key={channel.channelId}
                className="border-b border-gray-100 dark:border-gray-700/50 last:border-0"
              >
                <td className="py-3">
                  <span
                    className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                      index === 0
                        ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200'
                        : index === 1
                        ? 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'
                        : index === 2
                        ? 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200'
                        : 'bg-gray-50 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                    }`}
                  >
                    {index + 1}
                  </span>
                </td>
                <td className="py-3 font-medium text-gray-900 dark:text-gray-100">
                  {channel.channelName}
                </td>
                <td className="py-3 text-gray-500 dark:text-gray-400">
                  {channel.channelGroup}
                </td>
                <td className="py-3 text-right text-gray-900 dark:text-gray-100">
                  {formatDuration(channel.totalWatchTime)}
                </td>
                <td className="py-3 text-right text-gray-500 dark:text-gray-400">
                  {channel.totalSessions}
                </td>
                <td className="py-3 text-right text-gray-500 dark:text-gray-400">
                  {channel.totalUsers}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * 用户统计表格组件
 */
function UserStatsTable({ users }: { users: UserLiveStats[] }) {
  if (!users || users.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
          用户观看统计
        </h3>
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          <Users className="w-12 h-12 mx-auto mb-2 opacity-50" />
          <p>暂无数据</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
        用户观看统计
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-left text-sm text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
              <th className="pb-3 font-medium">用户名</th>
              <th className="pb-3 font-medium text-right">观看时长</th>
              <th className="pb-3 font-medium text-right">观看次数</th>
              <th className="pb-3 font-medium text-right">最后观看</th>
              <th className="pb-3 font-medium">最常看的频道</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr
                key={user.username}
                className="border-b border-gray-100 dark:border-gray-700/50 last:border-0"
              >
                <td className="py-3 font-medium text-gray-900 dark:text-gray-100">
                  {user.username}
                </td>
                <td className="py-3 text-right text-gray-900 dark:text-gray-100">
                  {formatDuration(user.totalWatchTime)}
                </td>
                <td className="py-3 text-right text-gray-500 dark:text-gray-400">
                  {user.totalSessions}
                </td>
                <td className="py-3 text-right text-gray-500 dark:text-gray-400">
                  {formatDate(user.lastWatchTime)}
                </td>
                <td className="py-3 text-gray-500 dark:text-gray-400">
                  {user.favoriteChannels?.[0]?.channelName || '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * 直播统计页面主组件
 */
export default function LiveStatsPage() {
  const [stats, setStats] = useState<GlobalLiveStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  /**
   * 获取统计数据
   * @param forceRefresh - 是否强制刷新缓存
   */
  const fetchStats = async (forceRefresh = false) => {
    try {
      if (forceRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      const url = forceRefresh
        ? '/api/admin/live-stats?refresh=true'
        : '/api/admin/live-stats';
      const response = await fetch(url);

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `请求失败: ${response.status}`);
      }

      const data = await response.json();
      setStats(data);
    } catch (err) {
      console.error('获取直播统计失败:', err);
      setError(err instanceof Error ? err.message : '获取数据失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  // 加载状态
  if (loading) {
    return (
      <PageLayout activePath="/admin">
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-400">加载中...</p>
          </div>
        </div>
      </PageLayout>
    );
  }

  // 错误状态
  if (error) {
    return (
      <PageLayout activePath="/admin">
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center max-w-md">
            <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
              <Radio className="w-8 h-8 text-red-500" />
            </div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
              加载失败
            </h2>
            <p className="text-gray-500 dark:text-gray-400 mb-4">{error}</p>
            <button
              onClick={() => fetchStats()}
              className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors"
            >
              重试
            </button>
          </div>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout activePath="/admin">
      <div className="py-6 px-5 lg:px-[3rem] 2xl:px-20 space-y-6">
        {/* 页面标题 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/admin"
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-gray-500 dark:text-gray-400" />
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <BarChart3 className="w-7 h-7 text-blue-500" />
                直播统计
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                查看用户直播观看数据统计
              </p>
            </div>
          </div>
          <button
            onClick={() => fetchStats(true)}
            disabled={refreshing}
            className="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-400 text-white rounded-lg transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? '刷新中...' : '刷新数据'}
          </button>
        </div>

        {/* 统计卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="观看用户数"
            value={stats?.totalUsers || 0}
            icon={Users}
            color="bg-blue-500"
          />
          <StatCard
            title="总观看时长"
            value={formatDuration(stats?.totalWatchTime || 0)}
            icon={Clock}
            color="bg-green-500"
          />
          <StatCard
            title="总观看次数"
            value={stats?.totalSessions || 0}
            icon={TrendingUp}
            color="bg-purple-500"
          />
          <StatCard
            title="今日活跃用户"
            value={stats?.todayActiveUsers || 0}
            icon={Radio}
            color="bg-orange-500"
          />
        </div>

        {/* 趋势图表 */}
        {stats?.dailyTrend && stats.dailyTrend.length > 0 && (
          <TrendChart data={stats.dailyTrend} title="近7天观看趋势" />
        )}

        {/* 热门频道和用户统计 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <HotChannelsTable channels={stats?.hotChannels || []} />
          <UserStatsTable users={stats?.userStats || []} />
        </div>
      </div>
    </PageLayout>
  );
}
