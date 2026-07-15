# Profile Photo Upload Fix

## Issue
Profile photos were not visibly updating after upload due to browser caching. The uploaded image would replace the file on disk, but the browser would serve the cached version since the URL remained the same.

## Root Cause
1. **Browser Caching**: When a photo is uploaded, the backend saves it with the same filename (e.g., `123.jpg`), causing browsers to serve the cached version
2. **No Cache Busting**: The component didn't append a cache-busting query parameter to force the browser to reload the image
3. **Missing Diagnostic Logging**: No console logs made debugging difficult

## Solution
Applied a **cache-busting strategy** by appending a timestamp query parameter to the avatar URL after upload.

### Changes Made

#### 1. Frontend Component - `src/components/employee/PhotoUpload.tsx`
- Added cache-busting timestamp to the uploaded URL: `${uploadedUrl}?t=${Date.now()}`
- Added comprehensive console logging to track the upload flow
- Logs now show: endpoint, server response, uploaded URL, and cache-busted URL

**Key change at line 221-226:**
```typescript
const uploadedUrl = data.avatarUrl ?? data.photoUrl ?? data.url ?? "";
// Add cache-busting timestamp to force browser to reload the image
const cacheBustedUrl = uploadedUrl ? `${uploadedUrl}?t=${Date.now()}` : uploadedUrl;
console.log("[PhotoUpload] Success! URL:", uploadedUrl, "Cache-busted:", cacheBustedUrl);
setPreview(normalizeFileUrl(cacheBustedUrl) ?? cacheBustedUrl);
onSuccess?.(uploadedUrl);
```

#### 2. Profile Page - `src/pages/Profile.tsx`
- Updated the `onSuccess` callback to apply cache-busting on the parent component state
- Added logging to track refetch completion
- Ensures the new avatar URL includes the timestamp

**Key change at line 281-290:**
```typescript
onSuccess={async (url) => {
  console.log("[Profile] Photo upload success, URL:", url);
  // Add cache-busting timestamp to force browser reload
  const cacheBustedUrl = url ? `${url}?t=${Date.now()}` : null;
  setAvatarUrl(cacheBustedUrl);
  // Hard remove queries to force fresh fetch
  queryClient.removeQueries({ queryKey: ["my-profile"] });
  queryClient.removeQueries({ queryKey: ["employee-profile"] });
  console.log("[Profile] Refetching employee data...");
  const result = await refetch();
  console.log("[Profile] Refetch complete:", result.data?.avatar_url);
}}
```

#### 3. Backend - `backend/src/modules/employees/employee.photo.compat.routes.ts`
- Added console logging to track file operations
- Logs show: employee ID, filename, old photo deletion, database update result
- Helps diagnose backend issues without checking files manually

**Key changes at lines 70, 76, 90:**
```typescript
console.log(`[Photo Upload] Saving photo for employee ${employeeId}: ${finalName}`);
// ... during old file deletion
console.log(`[Photo Upload] Deleting old photo: ${oldPath}`);
// ... after database update
console.log(`[Photo Upload] Database updated for employee ${employeeId}: ${fileUrl}`, result);
```

## How It Works Now

### Upload Flow:
1. User selects and crops photo
2. Frontend uploads cropped blob to backend
3. Backend saves file as `{employeeId}.{ext}` (e.g., `47814.jpg`)
4. Backend updates `employees.avatar_url` in database
5. Backend returns the clean URL: `/uploads/employee-photos/47814.jpg`
6. Frontend receives URL and appends timestamp: `/uploads/employee-photos/47814.jpg?t=1721234567890`
7. Frontend updates preview with cache-busted URL
8. Browser sees new URL, ignores cache, loads fresh image
9. React Query refetches employee data
10. Avatar displays immediately

### Console Output (Success):
```
[PhotoUpload] Uploading photo to: http://localhost:3000/api/employees/me/photo
[Photo Upload] Saving photo for employee 47814: 47814.jpg
[Photo Upload] Deleting old photo: /path/to/uploads/employee-photos/47814.png
[Photo Upload] Database updated for employee 47814: /uploads/employee-photos/47814.jpg
[PhotoUpload] Server response: { status: 200, data: { success: true, avatarUrl: "/uploads/employee-photos/47814.jpg" } }
[PhotoUpload] Success! URL: /uploads/employee-photos/47814.jpg Cache-busted: /uploads/employee-photos/47814.jpg?t=1721234567890
[Profile] Photo upload success, URL: /uploads/employee-photos/47814.jpg
[Profile] Refetching employee data...
[Profile] Refetch complete: /uploads/employee-photos/47814.jpg
```

## Testing Instructions

1. Start backend: `cd backend && npm run dev`
2. Start frontend: `npm run dev`
3. Open browser console (F12)
4. Navigate to Profile page
5. Click on avatar → select photo → crop → confirm
6. Watch console for the logged flow
7. Verify avatar updates immediately without page refresh

## Technical Notes

- **Cache Busting**: The `?t=timestamp` parameter is ignored by the backend but forces browsers to treat it as a new resource
- **Query Invalidation**: We use `queryClient.removeQueries()` instead of `invalidateQueries()` for immediate cache clearing
- **Normalized URLs**: The `normalizeMediaUrl()` function handles relative/absolute URL conversion
- **Image Format**: Backend supports JPG, PNG, WebP with 15MB max size
- **Security**: Backend enforces authentication via `requireAuth` middleware

## Files Modified
- `src/components/employee/PhotoUpload.tsx` (frontend component)
- `src/pages/Profile.tsx` (usage in profile page)
- `backend/src/modules/employees/employee.photo.compat.routes.ts` (backend API)

## Related Routes
- POST `/api/employees/me/photo` - Self-service upload
- POST `/api/employees/:id/photo` - Admin/HR upload for any employee
- DELETE `/api/employees/:id/photo` - Admin/HR delete photo

## Future Improvements (Optional)
- Add image optimization/compression on the backend
- Store multiple sizes (thumbnail, medium, full)
- Add WebP conversion for better compression
- Implement progressive image loading
- Add photo approval workflow for sensitive roles
