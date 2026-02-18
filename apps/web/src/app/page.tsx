'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export default function Home() {
  const [incidents, setIncidents] = useState<any[]>([]);
  const [documents, setDocuments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'ERS' | 'PALO'>('ERS');

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      const [incRes, docRes] = await Promise.all([
        supabase.from('incidents').select('*').order('created_at', { ascending: false }),
        supabase.from('vault_documents').select('*').order('created_at', { ascending: false })
      ]);

      if (incRes.data) setIncidents(incRes.data);
      if (docRes.data) setDocuments(docRes.data);
      setLoading(false);
    };

    fetchData();

    // Real-time subscriptions
    const incChannel = supabase
      .channel('incidents-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'incidents' }, payload => {
        setIncidents(prev => [payload.new, ...prev]);
      })
      .subscribe();

    const docChannel = supabase
      .channel('docs-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'vault_documents' }, payload => {
        setDocuments(prev => [payload.new, ...prev]);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(incChannel);
      supabase.removeChannel(docChannel);
    };
  }, []);

  const verifyDoc = async (id: string, status: string) => {
    const { error } = await supabase
      .from('vault_documents')
      .update({ verification_status: status })
      .eq('id', id);

    if (!error) {
      setDocuments(prev => prev.map(d => d.id === id ? { ...d, verification_status: status } : d));
    }
  };

  return (
    <main className="min-h-screen p-8 bg-zinc-950 text-white font-sans">
      <div className="max-w-5xl mx-auto">
        <header className="mb-12 flex justify-between items-center">
          <div>
            <h1 className="text-4xl font-black tracking-tighter text-red-500 italic">RESCUE ME <span className="text-white not-italic font-light">OS</span></h1>
            <p className="text-zinc-500 font-medium">Societal Operating System Dashboard</p>
          </div>
          <div className="flex gap-4">
            <button
              onClick={() => setActiveTab('ERS')}
              className={`px-6 py-2 rounded-full text-sm font-bold transition-all ${activeTab === 'ERS' ? 'bg-red-600 text-white shadow-lg shadow-red-900/20' : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800'}`}
            >
              ERS (INCIDENTS)
            </button>
            <button
              onClick={() => setActiveTab('PALO')}
              className={`px-6 py-2 rounded-full text-sm font-bold transition-all ${activeTab === 'PALO' ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20' : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800'}`}
            >
              PALO (VAULT)
            </button>
          </div>
        </header>

        {loading ? (
          <div className="flex justify-center items-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-500"></div>
          </div>
        ) : activeTab === 'ERS' ? (
          <section className="grid gap-6">
            <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
              🚨 Active Incidents
              <span className="bg-red-500/20 text-red-500 text-xs py-1 px-2 rounded-md animate-pulse">LIVE</span>
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {incidents.map((incident) => (
                <div key={incident.id} className="p-6 bg-zinc-900 border border-zinc-800 rounded-2xl hover:border-red-500/50 transition-all group">
                  <div className="flex justify-between items-start mb-4">
                    <span className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest bg-black px-2 py-1 rounded">#{incident.id.slice(0, 8)}</span>
                    <span className="px-3 py-1 bg-red-950 text-red-400 text-[10px] font-black rounded-full uppercase border border-red-900/50">
                      {incident.status}
                    </span>
                  </div>
                  <h3 className="text-xl font-bold mb-2 group-hover:text-red-400 transition-colors uppercase italic">{incident.type}</h3>
                  <p className="text-zinc-500 text-sm mb-6 leading-relaxed">
                    {incident.description || 'Emergency broadcast triggered.'}
                  </p>
                  <div className="flex items-center justify-between text-[11px] text-zinc-400 font-bold tracking-tight">
                    <div className="flex items-center gap-2 bg-black px-3 py-1.5 rounded-lg">
                      <span>📍 LAGOS, NGA</span>
                    </div>
                    <span>{new Date(incident.created_at).toLocaleTimeString()}</span>
                  </div>
                </div>
              ))}
              {incidents.length === 0 && <p className="text-zinc-600 italic py-12 text-center col-span-2 text-sm">Waiting for incoming signals...</p>}
            </div>
          </section>
        ) : (
          <section className="grid gap-6">
            <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
              📂 Document Verification
              <span className="bg-blue-500/20 text-blue-500 text-xs py-1 px-2 rounded-md font-mono">SECURE</span>
            </h2>
            <div className="overflow-hidden border border-zinc-800 rounded-2xl bg-zinc-900/50 backdrop-blur-sm">
              <table className="w-full text-left">
                <thead className="bg-zinc-900 text-zinc-500 text-[10px] font-black uppercase tracking-widest border-b border-zinc-800">
                  <tr>
                    <th className="px-6 py-4">Document</th>
                    <th className="px-6 py-4">Type</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {documents.map((doc) => (
                    <tr key={doc.id} className="hover:bg-zinc-800/30 transition-colors">
                      <td className="px-6 py-4">
                        <div className="font-bold text-sm">{doc.title}</div>
                        <div className="text-[10px] text-zinc-600 font-mono italic">{doc.id}</div>
                      </td>
                      <td className="px-6 py-4 text-xs font-medium text-zinc-400">{doc.document_type}</td>
                      <td className="px-6 py-4">
                        <span className={`px-2 py-1 rounded text-[10px] font-black uppercase ${doc.verification_status === 'VERIFIED' ? 'bg-green-500/20 text-green-500' :
                            doc.verification_status === 'REJECTED' ? 'bg-red-500/20 text-red-500' :
                              'bg-yellow-500/20 text-yellow-500'
                          }`}>
                          {doc.verification_status}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex gap-2">
                          <button
                            onClick={() => verifyDoc(doc.id, 'VERIFIED')}
                            className="bg-green-600 hover:bg-green-700 text-white text-[10px] font-black px-3 py-1 rounded transition-colors"
                          >
                            APPROVE
                          </button>
                          <button
                            onClick={() => verifyDoc(doc.id, 'REJECTED')}
                            className="bg-red-600 hover:bg-red-700 text-white text-[10px] font-black px-3 py-1 rounded transition-colors"
                          >
                            REJECT
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {documents.length === 0 && <p className="text-zinc-600 italic py-12 text-center text-sm">No documents pending verification.</p>}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
