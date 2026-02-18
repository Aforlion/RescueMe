import React, { useState, useEffect } from 'react';
import { View, StyleSheet, Text, FlatList, TouchableOpacity, Alert } from 'react-native';
import { supabase } from '../lib/supabase';

export default function PaloScreen() {
    const [documents, setDocuments] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchDocuments();
    }, []);

    const fetchDocuments = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('vault_documents')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;
            setDocuments(data || []);
        } catch (error: any) {
            console.error('Error fetching documents:', error.message);
        } finally {
            setLoading(false);
        }
    };

    const uploadMockDocument = async () => {
        Alert.alert('Upload Document', 'In a real app, this would open image picker. Mocking upload now...');
        // Real implementation would use Expo DocumentPicker and supabase.storage.from('vault').upload(...)
    };

    return (
        <View style={styles.container}>
            <Text style={styles.header}>PALO Vault</Text>
            <Text style={styles.subHeader}>Your Secure Identity & Survival Documents</Text>

            {loading ? (
                <Text style={styles.info}>Loading Vault...</Text>
            ) : (
                <FlatList
                    data={documents}
                    keyExtractor={(item) => item.id}
                    renderItem={({ item }) => (
                        <View style={styles.docItem}>
                            <Text style={styles.docTitle}>{item.title}</Text>
                            <Text style={styles.docType}>{item.document_type}</Text>
                            <Text style={[styles.status, item.verification_status === 'VERIFIED' ? styles.verified : styles.unverified]}>
                                {item.verification_status}
                            </Text>
                        </View>
                    )}
                    ListEmptyComponent={<Text style={styles.empty}>Your vault is currently empty.</Text>}
                />
            )}

            <TouchableOpacity style={styles.uploadButton} onPress={uploadMockDocument}>
                <Text style={styles.uploadText}>+ ADD DOCUMENT</Text>
            </TouchableOpacity>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f5f5f5',
        padding: 24,
    },
    header: {
        fontSize: 28,
        fontWeight: '800',
        color: '#141414',
        marginTop: 40,
    },
    subHeader: {
        fontSize: 14,
        color: '#8c8c8c',
        marginBottom: 24,
    },
    docItem: {
        backgroundColor: '#fff',
        padding: 16,
        borderRadius: 12,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: '#d9d9d9',
    },
    docTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#262626',
    },
    docType: {
        fontSize: 12,
        color: '#595959',
        marginTop: 4,
    },
    status: {
        fontSize: 10,
        fontWeight: '700',
        marginTop: 8,
        alignSelf: 'flex-start',
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 4,
    },
    verified: {
        backgroundColor: '#f6ffed',
        color: '#52c41a',
    },
    unverified: {
        backgroundColor: '#fff7e6',
        color: '#fa8c16',
    },
    info: {
        textAlign: 'center',
        marginTop: 100,
        color: '#8c8c8c',
    },
    empty: {
        textAlign: 'center',
        marginTop: 60,
        color: '#bfbfbf',
        fontStyle: 'italic',
    },
    uploadButton: {
        backgroundColor: '#1890ff',
        padding: 16,
        borderRadius: 12,
        alignItems: 'center',
        marginTop: 'auto',
    },
    uploadText: {
        color: '#fff',
        fontWeight: '700',
        fontSize: 16,
    },
});
