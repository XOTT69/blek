// Only public Supabase connection values belong here. Never expose the service-role key.
export default function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.status(200).json({ url: process.env.SUPABASE_URL || '', anonKey: process.env.SUPABASE_ANON_KEY || '' });
}
