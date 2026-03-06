'use client';

import React, { useState, useEffect } from 'react';

interface Vendor {
  id: number;
  name: string;
  address?: string;
  city?: string;
  state_code?: string;
  zip?: string;
  phone?: string;
  email_address?: string;
  updated_at?: string;
  origin_id?: string;
}

export default function VendorsPage() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const fetchVendors = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/procore/vendors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ perPage: 500 }) 
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.details || data.error || 'API Error');
      
      setVendors(data.vendors || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVendors();
  }, []);

  const filteredVendors = vendors.filter(v => 
    v.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (v.id && String(v.id).includes(searchTerm))
  );

  return (
    <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto', fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.875rem', fontWeight: 'bold' }}>Procore Vendor Directory</h1>
        <button 
          onClick={fetchVendors}
          disabled={loading}
          style={{
            padding: '0.5rem 1rem',
            backgroundColor: '#2563eb',
            color: 'white',
            border: 'none',
            borderRadius: '0.375rem',
            cursor: loading ? 'not-allowed' : 'pointer'
          }}
        >
          {loading ? 'Refreshing...' : 'Refresh List'}
        </button>
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <input 
          type="text"
          placeholder="Search by vendor name or ID..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{
            width: '100%',
            padding: '0.75rem',
            borderRadius: '0.375rem',
            border: '1px solid #d1d5db',
            fontSize: '1rem'
          }}
        />
      </div>

      {error && (
        <div style={{ padding: '1rem', backgroundColor: '#fee2e2', color: '#b91c1c', borderRadius: '0.375rem', marginBottom: '1.5rem' }}>
          Error: {error}
        </div>
      )}

      <div style={{ backgroundColor: 'white', borderRadius: '0.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead style={{ backgroundColor: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
            <tr>
              <th style={{ padding: '0.75rem 1rem', fontWeight: '600' }}>Vendor Name</th>
              <th style={{ padding: '0.75rem 1rem', fontWeight: '600' }}>ID</th>
              <th style={{ padding: '0.75rem 1rem', fontWeight: '600' }}>Contact</th>
              <th style={{ padding: '0.75rem 1rem', fontWeight: '600' }}>Location</th>
              <th style={{ padding: '0.75rem 1rem', fontWeight: '600' }}>Last Updated</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} style={{ padding: '2rem', textAlign: 'center', color: '#6b7280' }}>Loading vendors from Procore...</td>
              </tr>
            ) : filteredVendors.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: '2rem', textAlign: 'center', color: '#6b7280' }}>No vendors found.</td>
              </tr>
            ) : (
              filteredVendors.map((vendor) => (
                <tr key={vendor.id} style={{ borderBottom: '1px solid #f3f4f6', hover: { backgroundColor: '#f9fafb' } }}>
                  <td style={{ padding: '1rem', fontWeight: '500', color: '#111827' }}>{vendor.name}</td>
                  <td style={{ padding: '1rem', color: '#6b7280', fontSize: '0.875rem', fontFamily: 'monospace' }}>{vendor.id}</td>
                  <td style={{ padding: '1rem', fontSize: '0.875rem' }}>
                    <div>{vendor.email_address || '---'}</div>
                    <div style={{ color: '#6b7280' }}>{vendor.phone}</div>
                  </td>
                  <td style={{ padding: '1rem', fontSize: '0.875rem' }}>
                    {vendor.city ? `${vendor.city}${vendor.state_code ? `, ${vendor.state_code}` : ''}` : '---'}
                  </td>
                  <td style={{ padding: '1rem', fontSize: '0.875rem', color: '#6b7280' }}>
                    {vendor.updated_at ? new Date(vendor.updated_at).toLocaleDateString() : '---'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
