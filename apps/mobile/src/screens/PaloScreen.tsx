import React, { useState, useEffect } from 'react';
import { View, StyleSheet, Text, FlatList, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { supabase } from '@rescueme/supabase';
import type { VaultDocument } from '@rescueme/types';
import { tokens } from '@rescueme/ui';

export default function PaloScreen() {
    const [documents, setDocuments] = useState<VaultDocument[]>([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);

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

    const pickAndUploadDocument = async () => {
        try {
            const result = await DocumentPicker.getDocumentAsync({
                type: '*/*',
                copyToCacheDirectory: true,
            });

            if (result.canceled) return;

            const file = result.assets[0];
            setUploading(true);

            // 1. Prepare File for Upload
            const response = await fetch(file.uri);
            const blob = await response.blob();
            const fileName = `${Date.now()}-${file.name}`;
            const filePath = `user_vault/${fileName}`;

            // 2. Upload to Supabase Storage
            const { error: uploadError } = await supabase.storage
                .from('vault-documents')
                .upload(filePath, blob, {
                    contentType: file.mimeType,
                });

            if (uploadError) {
                if (uploadError.message.includes('Bucket not found')) {
                    throw new Error('Storage bucket not initialized. Please ensure the "vault-documents" bucket is created in the Supabase Dashboard.');
                }
                throw uploadError;
            }

            // 3. Register in Database
            const { error: dbError } = await supabase
                .from('vault_documents')
                .insert({
                    title: file.name,
                    document_type: file.mimeType || 'UNKNOWN',
                    file_url: filePath,
                    verification_status: 'PENDING',
                });

            if (dbError) throw dbError;

            Alert.alert('Success', 'Document uploaded to vault and pending verification.');
            fetchDocuments();
        } catch (error: any) {
            Alert.alert('Upload Failed', error.message);
        } finally {
            setUploading(false);
        }
    };

    return (
        <View style={styles.container}>
            <Text style={styles.header}>PALO VAULT</Text>
            <Text style={styles.subHeader}>SECURE SURVIVAL ASSETS</Text>

            {loading ? (
                <View style={[styles.centered, { marginTop: 100 }]}>
                    <ActivityIndicator color={tokens.colors.secondary} size="large" />
                    <Text style={styles.info}>ACCESSING VAULT...</Text>
                </View>
            ) : (
                <FlatList
                    data={documents}
                    keyExtractor={(item) => item.id}
                    renderItem={({ item }) => (
                        <View style={styles.docItem}>
                            <View style={styles.docInfo}>
                                <Text style={styles.docTitle}>{item.title}</Text>
                                <Text style={styles.docType}>{item.document_type}</Text>
                            </View>
                            <View style={[
                                styles.statusBadge,
                                item.verification_status === 'VERIFIED' ? styles.statusVerified :
                                    item.verification_status === 'REJECTED' ? styles.statusRejected : styles.statusPending
                            ]}>
                                <Text style={[
                                    styles.statusText,
                                    item.verification_status === 'VERIFIED' ? styles.textVerified :
                                        item.verification_status === 'REJECTED' ? styles.textRejected : styles.textPending
                                ]}>
                                    {item.verification_status}
                                </Text>
                            </View>
                        </View>
                    )}
                    ListEmptyComponent={<Text style={styles.empty}>Your vault is empty. Upload your first document.</Text>}
                />
            )}

            <TouchableOpacity
                style={[styles.uploadButton, uploading && styles.disabledButton]}
                onPress={pickAndUploadDocument}
                disabled={uploading}
            >
                {uploading ? (
                    <ActivityIndicator color="#fff" />
                ) : (
                    <Text style={styles.uploadText}>+ UPLOAD TO VAULT</Text>
                )}
            </TouchableOpacity>
        </View>
    );
}


const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: tokens.colors.background,
        padding: tokens.spacing.lg,
    },
    centered: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    header: {
        fontSize: 32,
        fontWeight: '900',
        color: tokens.colors.text.primary,
        marginTop: 40,
        letterSpacing: -1,
    },
    subHeader: {
        fontSize: 10,
        fontWeight: '900',
        color: tokens.colors.secondary,
        marginBottom: 32,
        letterSpacing: 2,
    },
    docItem: {
        backgroundColor: '#fff',
        padding: tokens.spacing.md,
        borderRadius: tokens.borderRadius.lg,
        marginBottom: tokens.spacing.sm,
        borderWidth: 1,
        borderColor: tokens.colors.surface,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 4,
        elevation: 2,
    },
    docInfo: {
        flex: 1,
    },
    docTitle: {
        fontSize: 14,
        fontWeight: '700',
        color: tokens.colors.text.primary,
    },
    docType: {
        fontSize: 10,
        color: tokens.colors.text.secondary,
        marginTop: 2,
        fontWeight: 'bold',
    },
    statusBadge: {
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: tokens.borderRadius.sm,
    },
    statusPending: {
        backgroundColor: '#fff7e6',
    },
    statusVerified: {
        backgroundColor: '#f6ffed',
    },
    statusRejected: {
        backgroundColor: '#fff1f0',
    },
    statusText: {
        fontSize: 10,
        fontWeight: '900',
        textTransform: 'uppercase',
    },
    textPending: {
        color: tokens.colors.warning,
    },
    textVerified: {
        color: tokens.colors.success,
    },
    textRejected: {
        color: tokens.colors.error,
    },
    info: {
        marginTop: 16,
        color: tokens.colors.text.secondary,
        fontSize: 10,
        fontWeight: '900',
        letterSpacing: 1,
    },
    empty: {
        textAlign: 'center',
        marginTop: 60,
        color: tokens.colors.text.secondary,
        fontStyle: 'italic',
        fontSize: 12,
    },
    uploadButton: {
        backgroundColor: tokens.colors.secondary,
        padding: tokens.spacing.md,
        borderRadius: tokens.borderRadius.lg,
        alignItems: 'center',
        marginTop: 'auto',
    },
    disabledButton: {
        opacity: 0.7,
    },
    uploadText: {
        color: '#fff',
        fontWeight: '900',
        fontSize: 14,
        letterSpacing: 1,
    },
});

