import { NextResponse } from 'next/server';
import { generateSeeds } from '@/lib/discovery/generateSeeds';

export async function POST(request: Request) {
  const body = await request.json();
  const count = typeof body.count === 'number' ? body.count : 20;

  const seeds = await generateSeeds({ count });

  return NextResponse.json({ seeds });
}
