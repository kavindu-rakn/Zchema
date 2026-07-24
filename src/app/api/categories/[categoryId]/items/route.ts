import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

export async function GET(request: Request, { params }: { params: Promise<{ categoryId: string }> }) {
  const supabase = await createClient();
  const { categoryId } = await params;
  
  const { data, error } = await supabase
    .from('items')
    .select('*')
    .eq('category_id', categoryId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(request: Request, { params }: { params: Promise<{ categoryId: string }> }) {
  const supabase = await createClient();
  const { categoryId } = await params;
  const body = await request.json();

  const { data, error } = await supabase
    .from('items')
    .insert([{ category_id: categoryId, data: body.data }])
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
