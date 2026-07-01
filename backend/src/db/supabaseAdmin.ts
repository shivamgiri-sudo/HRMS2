/**
 * Supabase has been removed from this project.
 * This file is kept as a tombstone so existing import statements compile
 * without errors while the codebase is cleaned up.
 * All callers should be migrated to MySQL — delete this file once confirmed.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const supabaseAdmin: any = {
  from: () => ({
    select: async () => ({ data: [], error: null }),
    insert: async () => ({ data: null, error: null }),
    update: async () => ({ data: null, error: null }),
    delete: async () => ({ data: null, error: null }),
    upsert: async () => ({ data: null, error: null }),
  }),
  auth: {
    getUser: async () => ({ data: { user: null }, error: null }),
    admin: {
      createUser: async () => ({ data: { user: null }, error: null }),
    },
  },
  storage: {
    from: () => ({
      upload: async () => ({ data: null, error: null }),
      download: async () => ({ data: null, error: null }),
      getPublicUrl: () => ({ data: { publicUrl: "" } }),
      remove: async () => ({ data: null, error: null }),
    }),
  },
  functions: {
    invoke: async () => ({ data: null, error: null }),
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const supabaseAuthClient: any = {
  auth: {
    getUser: async () => ({ data: { user: null }, error: null }),
  },
};
