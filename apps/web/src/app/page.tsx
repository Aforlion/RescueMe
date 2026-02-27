'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@rescueme/supabase';
import type { Incident, VaultDocument, IncidentStatus, Transaction } from '@rescueme/types';
import { tokens } from '@rescueme/ui';

export default function Home() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [documents, setDocuments] = useState<VaultDocument[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'ERS' | 'PALO' | 'LEDGER'>('ERS');

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      const [incRes, docRes, transRes] = await Promise.all([
        supabase.from('incidents').select('*').order('created_at', { ascending: false }),
        supabase.from('vault_documents').select('*').order('created_at', { ascending: false }),
        supabase.from('transactions').select('*').order('created_at', { ascending: false }).limit(50)
      ]);

      if (incRes.data) setIncidents(incRes.data);
      if (docRes.data) setDocuments(docRes.data);
      if (transRes.data) setTransactions(transRes.data as any);
      setLoading(false);
    };

    fetchData();

    // Real-time subscriptions
    const incChannel = supabase
      .channel('incidents-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'incidents' }, payload => {
        if (payload.eventType === 'INSERT') {
          setIncidents(prev => [payload.new as Incident, ...prev]);
        } else if (payload.eventType === 'UPDATE') {
          setIncidents(prev => prev.map(inc => inc.id === payload.new.id ? payload.new as Incident : inc));
        }
      })
      .subscribe();

    const docChannel = supabase
      .channel('docs-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'vault_documents' }, payload => {
        setDocuments(prev => [payload.new as VaultDocument, ...prev]);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(incChannel);
      supabase.removeChannel(docChannel);
    };
  }, []);

  const updateIncidentStatus = async (id: string, status: IncidentStatus, userId?: string) => {
    const { error } = await supabase
      .from('incidents')
      .update({ status })
      .eq('id', id);

    if (error) { console.error('Error updating incident:', error.message); return; }

    // 🪙 Reputation Engine: Reward guide on resolution
    if (status === 'RESOLVED' && userId) {
      await supabase.rpc('add_tokens', {
        target_user_id: userId,
        amount_to_add: 50,
        trans_type: 'REWARD',
        trans_desc: `Incident resolved: ${id.slice(0, 8)}`,
      });
    }
  };

  const verifyDoc = async (id: string, status: string, userId?: string) => {
    const { error } = await supabase
      .from('vault_documents')
      .update({ verification_status: status })
      .eq('id', id);

    if (!error) {
      setDocuments(prev => prev.map(d => d.id === id ? { ...d, verification_status: status as any } : d));

      // 🪙 Reputation Engine: Reward on VERIFIED document
      if (status === 'VERIFIED' && userId) {
        await supabase.rpc('add_tokens', {
          target_user_id: userId,
          amount_to_add: 20,
          trans_type: 'REWARD',
          trans_desc: `Identity document verified: ${id.slice(0, 8)}`,
        });
      }
    }
  };

  return (
    <main className="min-h-screen p-8 bg-zinc-950 text-white font-sans">
      <div className="max-w-5xl mx-auto">
        <header className="mb-12 flex justify-between items-center border-b border-zinc-900 pb-8">
          <div>
            <h1 className="text-4xl font-black tracking-tighter text-red-500 italic">RESCUE ME <span className="text-white not-italic font-light">OS</span></h1>
            <p className="text-zinc-500 font-medium">Societal Operating System Dashboard</p>
          </div>
          <div className="flex gap-4">
            <button
              onClick={() => setActiveTab('ERS')}
              className={`px-6 py-3 rounded-xl text-sm font-bold transition-all border ${activeTab === 'ERS' ? 'bg-red-600 border-red-500 text-white shadow-lg shadow-red-900/20' : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:bg-zinc-800'}`}
            >
              ERS (INCIDENTS)
            </button>
            <button
              onClick={() => setActiveTab('PALO')}
              className={`px-6 py-3 rounded-xl text-sm font-bold transition-all border ${activeTab === 'PALO' ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-900/20' : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:bg-zinc-800'}`}
            >
              PALO (VAULT)
            </button>
            <button
              onClick={() => setActiveTab('LEDGER')}
              className={`px-6 py-3 rounded-xl text-sm font-bold transition-all border ${activeTab === 'LEDGER' ? 'bg-yellow-500 border-yellow-400 text-black shadow-lg shadow-yellow-900/20' : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:bg-zinc-800'}`}
            >
              🪙 LEDGER
            </button>
          </div>
        </header>

        {loading ? (
          <div className="flex justify-center items-center h-64">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-red-500"></div>
          </div>
        ) : activeTab === 'ERS' ? (
          <section className="grid gap-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-black flex items-center gap-3">
                🚨 System Alert Engine
                <span className="bg-red-500 text-white text-[10px] py-1 px-3 rounded-full font-black animate-pulse uppercase tracking-widest">Live Signals</span>
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {incidents.map((incident) => (
                <div key={incident.id} className={`p-6 bg-zinc-900 border-2 rounded-3xl transition-all group ${incident.status === 'PENDING' ? 'border-red-600/50 shadow-xl shadow-red-900/10' : 'border-zinc-800'}`}>
                  <div className="flex justify-between items-start mb-6">
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest font-black">Ref: {incident.id.slice(0, 8)}</span>
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${incident.status === 'PENDING' ? 'bg-red-500 animate-ping' : 'bg-zinc-500'}`} />
                        <span className={`text-[10px] font-black uppercase tracking-tighter ${incident.status === 'PENDING' ? 'text-red-400' : 'text-zinc-400'}`}>
                          Status: {incident.status}
                        </span>
                      </div>
                    </div>
                    {incident.latitude && (
                      <a href={`https://www.google.com/maps?q=${incident.latitude},${incident.longitude}`} target="_blank" className="bg-black hover:bg-zinc-800 p-2 rounded-xl transition-colors border border-zinc-800">
                        <span className="text-[10px] font-black">📍 VIEW MAP</span>
                      </a>
                    )}
                  </div>

                  <h3 className="text-2xl font-black mb-2 uppercase italic tracking-tighter group-hover:text-red-500 transition-colors">
                    {incident.type}
                  </h3>
                  <p className="text-zinc-400 text-sm mb-8 leading-relaxed font-medium">
                    {incident.description || 'Global SOS trigger received.'}
                  </p>

                  <div className="flex gap-2">
                    {incident.status === 'PENDING' && (
                      <button
                        onClick={() => updateIncidentStatus(incident.id, 'ASSIGNED')}
                        className="flex-1 bg-red-600 hover:bg-red-700 text-white text-xs font-black py-4 rounded-2xl transition-all active:scale-95"
                      >
                        DISPATCH GUIDE
                      </button>
                    )}
                    {incident.status === 'ASSIGNED' && (
                      <button
                        onClick={() => updateIncidentStatus(incident.id, 'RESOLVED')}
                        className="flex-1 bg-green-600 hover:bg-green-700 text-white text-xs font-black py-4 rounded-2xl transition-all"
                      >
                        CLOSE CASE
                      </button>
                    )}
                    <button className="bg-zinc-800 hover:bg-zinc-700 text-zinc-500 px-4 rounded-2xl transition-colors">
                      •••
                    </button>
                  </div>
                </div>
              ))}
              {incidents.length === 0 && (
                <div className="col-span-2 py-20 bg-zinc-900/40 rounded-3xl border border-dashed border-zinc-800 flex flex-col items-center justify-center">
                  <span className="text-4xl mb-4 grayscale">📡</span>
                  <p className="text-zinc-500 font-bold uppercase text-xs tracking-widest">Scanning for emergency frequencies...</p>
                </div>
              )}
            </div>
          </section>
        ) : activeTab === 'PALO' ? (
          <section className="grid gap-6">
            <h2 className="text-2xl font-black mb-6 flex items-center gap-3">
              📂 PALO Verification Vault
              <span className="bg-blue-600 text-white text-[10px] py-1 px-3 rounded-full font-black uppercase tracking-widest">Encrypted</span>
            </h2>
            <div className="overflow-hidden border border-zinc-900 rounded-3xl bg-zinc-900/20 backdrop-blur-xl">
              <table className="w-full text-left">
                <thead className="bg-zinc-900 text-zinc-500 text-[10px] font-black uppercase tracking-widest">
                  <tr>
                    <th className="px-8 py-6">Document</th>
                    <th className="px-8 py-6">Type</th>
                    <th className="px-8 py-6">Status</th>
                    <th className="px-8 py-6 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-900">
                  {documents.map((doc) => (
                    <tr key={doc.id} className="hover:bg-zinc-900/40 transition-colors group">
                      <td className="px-8 py-6">
                        <div className="font-black text-sm uppercase tracking-tight group-hover:text-blue-400 transition-colors">{doc.title}</div>
                        <div className="text-[10px] text-zinc-600 font-mono mt-1 italic">{doc.id}</div>
                      </td>
                      <td className="px-8 py-6">
                        <span className="text-[10px] font-black bg-zinc-900 px-3 py-1 rounded-md text-zinc-400 border border-zinc-800 uppercase tracking-tighter">
                          {doc.document_type}
                        </span>
                      </td>
                      <td className="px-8 py-6">
                        <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-tighter ${doc.verification_status === 'VERIFIED' ? 'bg-green-500/10 text-green-500 border border-green-500/20' :
                          doc.verification_status === 'REJECTED' ? 'bg-red-500/10 text-red-500 border border-red-500/20' :
                            'bg-yellow-500/10 text-yellow-500 border border-yellow-500/20'
                          }`}>
                          {doc.verification_status}
                        </span>
                      </td>
                      <td className="px-8 py-6 text-right">
                        <div className="flex gap-3 justify-end">
                          <button
                            onClick={() => verifyDoc(doc.id, 'VERIFIED')}
                            className="bg-zinc-900 hover:bg-green-600 text-zinc-400 hover:text-white text-[10px] font-black px-4 py-2 rounded-xl transition-all active:scale-95 uppercase tracking-tighter"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => verifyDoc(doc.id, 'REJECTED')}
                            className="bg-zinc-900 hover:bg-red-600 text-zinc-400 hover:text-white text-[10px] font-black px-4 py-2 rounded-xl transition-all active:scale-95 uppercase tracking-tighter"
                          >
                            Reject
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {documents.length === 0 && <p className="text-zinc-600 italic py-20 text-center text-sm font-bold uppercase tracking-widest">No vault assets pending audit.</p>}
            </div>
          </section>
        ) : (
          /* LEDGER TAB */
          <section className="grid gap-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-black flex items-center gap-3">
                🪙 Equity Ledger
                <span className="bg-yellow-500 text-black text-[10px] py-1 px-3 rounded-full font-black uppercase tracking-widest">On-Chain Simulation</span>
              </h2>
            </div>

            <div className="overflow-hidden border border-zinc-900 rounded-3xl bg-zinc-900/20">
              <table className="w-full text-left">
                <thead className="bg-zinc-900 text-zinc-500 text-[10px] font-black uppercase tracking-widest">
                  <tr>
                    <th className="px-8 py-6">Description</th>
                    <th className="px-8 py-6">Type</th>
                    <th className="px-8 py-6">Date</th>
                    <th className="px-8 py-6 text-right">Amount (RME)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-900">
                  {transactions.map((tx) => (
                    <tr key={tx.id} className="hover:bg-zinc-900/40 transition-colors group">
                      <td className="px-8 py-5">
                        <div className="font-bold text-sm text-white group-hover:text-yellow-400 transition-colors">{tx.description}</div>
                        <div className="text-[10px] text-zinc-600 font-mono mt-1">{tx.user_id?.slice(0, 12)}...</div>
                      </td>
                      <td className="px-8 py-5">
                        <span className={`text-[10px] font-black px-3 py-1 rounded-md uppercase tracking-tighter border ${tx.type === 'REWARD' ? 'bg-green-500/10 text-green-400 border-green-500/20' :
                          tx.type === 'PENALTY' ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                            'bg-zinc-800 text-zinc-400 border-zinc-700'
                          }`}>{tx.type}</span>
                      </td>
                      <td className="px-8 py-5 text-zinc-500 text-[11px] font-mono">
                        {new Date(tx.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-8 py-5 text-right">
                        <span className={`font-black text-lg ${tx.amount > 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {tx.amount > 0 ? '+' : ''}{tx.amount}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {transactions.length === 0 && <p className="text-zinc-600 italic py-20 text-center text-sm font-bold uppercase tracking-widest">Ledger empty. Resolve incidents to earn RME.</p>}
            </div>
          </section>
        )}

      </div>
    </main>
  );
}
