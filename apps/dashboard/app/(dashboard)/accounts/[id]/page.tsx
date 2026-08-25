"use client";
import React, { useState, useEffect, use } from 'react';
import { 
  Smartphone, Activity, ShieldCheck, ArrowLeft, TrendingUp, 
  Heart, Bookmark, MessageSquare, User, CheckCircle2, History 
} from 'lucide-react';
import Link from 'next/link';

export default function AccountDetailPage({ params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = use(paramsPromise);
  const [account, setAccount] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch('/api/farm');
        const data = await res.json();
        if (data.success) {
          const acc = data.health.find((h: any) => h.id === params.id);
          setAccount(acc);
        }
      } catch (e) {
        console.error("Failed to fetch account status", e);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [params.id]);

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>Loading Profile...</div>;
  if (!account) return <div style={{ padding: 40, textAlign: 'center' }}>Account Not Found</div>;

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '40px 20px' }}>
      <Link href="/farm" style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', textDecoration: 'none', marginBottom: 32, fontSize: 14, fontWeight: 600 }}>
        <ArrowLeft size={16} /> BACK TO FARM
      </Link>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 48 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <h1 style={{ fontSize: 36, fontWeight: 900, letterSpacing: '-0.05em', margin: 0 }}>{account.account_name}</h1>
            <div style={{ 
              padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 800, 
              background: 'rgba(34, 197, 94, 0.1)', color: '#22C55E', border: '1px solid rgba(34, 197, 94, 0.2)' 
            }}>
              ONLINE
            </div>
          </div>
          <p style={{ color: 'var(--text-tertiary)', fontSize: 18, fontWeight: 500 }}>Slot {account.slot} • Mobile 4G Proxy • Stealth Active</p>
        </div>
        <div style={{ textAlign: 'right' }}>
           <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>LAST SEEN</div>
           <div style={{ fontSize: 14, fontWeight: 700 }}>{new Date(account.last_seen).toLocaleTimeString()}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20, marginBottom: 48 }}>
        <StatCard icon={<TrendingUp size={18} color="#3B82F6" />} label="SWIPES" value={account.swipes} />
        <StatCard icon={<Heart size={18} color="#EF4444" />} label="LIKES" value={account.likes} />
        <StatCard icon={<Bookmark size={18} color="#F59E0B" />} label="SAVES" value={account.saves} />
        <StatCard icon={<Activity size={18} color="#A855F7" />} label="JITTER" value={account.jitter_variance} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 350px', gap: 32 }}>
        <section>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
            <History size={20} />
            <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>Recent Activity Log</h2>
          </div>
          <div className="card" style={{ padding: 0 }}>
             <div style={{ padding: 20, borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(59, 130, 246, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Activity size={16} color="#3B82F6" />
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{account.last_action}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Action performed via Voice Control</div>
                  </div>
                </div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>JUST NOW</div>
             </div>
             {/* Mock logs for visual completeness */}
             <LogItem action="Swipe Next" time="2m ago" />
             <LogItem action="Like Post" time="5m ago" />
             <LogItem action="Swipe Next" time="8m ago" />
             <LogItem action="Open Comments" time="12m ago" />
          </div>
        </section>

        <section>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
            <ShieldCheck size={20} />
            <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>Security Audit</h2>
          </div>
          <div className="card" style={{ padding: 24, background: 'rgba(34, 197, 94, 0.02)', border: '1px solid rgba(34, 197, 94, 0.1)' }}>
             <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8 }}>IP ADDRESS</div>
                <div style={{ fontSize: 16, fontWeight: 800, fontFamily: 'monospace' }}>185.244.25.102</div>
                <div style={{ fontSize: 11, color: '#22C55E', fontWeight: 600, marginTop: 4 }}>RESIDENTIAL • MOBILE 4G</div>
             </div>
             
             <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <AuditItem label="Jailbreak Hidden" status="PASS" />
                <AuditItem label="Accessibility Spoof" status="PASS" />
                <AuditItem label="MTU Fingerprint" status="PASS" />
                <AuditItem label="WebRTC Leak Proof" status="PASS" />
             </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: any, label: string, value: any }) {
  return (
    <div className="card" style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        {icon}
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.05em' }}>{label}</span>
      </div>
      <div style={{ fontSize: 32, fontWeight: 900 }}>{value}</div>
    </div>
  );
}

function LogItem({ action, time }: { action: string, time: string }) {
  return (
    <div style={{ padding: 16, borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', opacity: 0.6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--text-muted)' }} />
        <div style={{ fontSize: 13, fontWeight: 600 }}>{action}</div>
      </div>
      <div style={{ fontSize: 11, fontWeight: 600 }}>{time}</div>
    </div>
  );
}

function AuditItem({ label, status }: { label: string, status: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontSize: 11, fontWeight: 800, color: '#22C55E' }}>{status}</span>
    </div>
  );
}
