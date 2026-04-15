import { PoolClient } from 'pg';
import pool from '../db/client.js';
import { logEvent } from '../utils/logEvent.js';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const TWO_DAYS_MS = 48 * 60 * 60 * 1000;

export interface UserStreakState {
  phoneNumber: string;
  streakCount: number;
  totalCalls: number;
  firstCallAt: Date;
  lastStreakQualifiedAt: Date;
}

interface UserRow {
  phone_number: string;
  streak_count: number;
  total_calls: number;
  first_call_at: Date;
  last_streak_qualified_at: Date | null;
}

function isValidDate(value: Date | null): value is Date {
  return Boolean(value && !Number.isNaN(value.getTime()));
}

function mapState(row: UserRow): UserStreakState {
  return {
    phoneNumber: row.phone_number,
    streakCount: row.streak_count,
    totalCalls: row.total_calls,
    firstCallAt: row.first_call_at,
    lastStreakQualifiedAt: row.last_streak_qualified_at ?? row.first_call_at,
  };
}

async function insertNewUser(client: PoolClient, phoneNumber: string, nowUtc: Date): Promise<UserStreakState> {
  const result = await client.query<UserRow>(
    `INSERT INTO users (
      phone_number,
      streak_count,
      last_streak_qualified_at,
      total_calls,
      first_call_at,
      created_at,
      updated_at
    ) VALUES ($1, 1, $2, 1, $2, $2, $2)
    RETURNING
      phone_number,
      streak_count,
      total_calls,
      first_call_at,
      last_streak_qualified_at`,
    [phoneNumber, nowUtc]
  );

  logEvent('user_created', { phone_number: phoneNumber });
  return mapState(result.rows[0]);
}

export async function updateUserStreak(phoneNumber: string, nowUtc: Date): Promise<UserStreakState> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const existingResult = await client.query<UserRow>(
      `SELECT
        phone_number,
        streak_count,
        total_calls,
        first_call_at,
        last_streak_qualified_at
      FROM users
      WHERE phone_number = $1
      FOR UPDATE`,
      [phoneNumber]
    );

    if (existingResult.rows.length === 0) {
      const newUser = await insertNewUser(client, phoneNumber, nowUtc);
      await client.query('COMMIT');
      return newUser;
    }

    const existing = existingResult.rows[0];
    const lastQualifiedAt = existing.last_streak_qualified_at;
    const currentTotalCalls = existing.total_calls + 1;

    let nextStreakCount = existing.streak_count;
    let nextQualifiedAt = lastQualifiedAt;

    if (!isValidDate(lastQualifiedAt)) {
      nextStreakCount = 1;
      nextQualifiedAt = nowUtc;
    } else {
      const deltaMs = nowUtc.getTime() - lastQualifiedAt.getTime();

      if (deltaMs < ONE_DAY_MS) {
        nextStreakCount = existing.streak_count;
      } else if (deltaMs < TWO_DAYS_MS) {
        nextStreakCount = existing.streak_count + 1;
        nextQualifiedAt = nowUtc;
        logEvent('streak_incremented', {
          phone_number: phoneNumber,
          previous_streak: existing.streak_count,
          streak_count: nextStreakCount,
        });
      } else {
        nextStreakCount = 1;
        nextQualifiedAt = nowUtc;
        logEvent('streak_reset', {
          phone_number: phoneNumber,
          previous_streak: existing.streak_count,
        });
      }
    }

    if (!isValidDate(lastQualifiedAt)) {
      logEvent('streak_reset', {
        phone_number: phoneNumber,
        previous_streak: existing.streak_count,
        reason: 'invalid_last_streak_qualified_at',
      });
    }

    const updatedResult = await client.query<UserRow>(
      `UPDATE users
      SET
        streak_count = $2,
        last_streak_qualified_at = $3,
        total_calls = $4,
        updated_at = $5
      WHERE phone_number = $1
      RETURNING
        phone_number,
        streak_count,
        total_calls,
        first_call_at,
        last_streak_qualified_at`,
      [phoneNumber, nextStreakCount, nextQualifiedAt, currentTotalCalls, nowUtc]
    );

    await client.query('COMMIT');
    return mapState(updatedResult.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
