-- HRMS Bulk Upload Hub + Process Master production fix
-- Adds the missing tables/functions/bucket used by BulkUploadHub.tsx and backend /api/processes.

-- =====================================================
-- Storage bucket for uploaded source files
-- =====================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('hrms-bulk-uploads', 'hrms-bulk-uploads', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Admin HR can upload bulk files" ON storage.objects;
DROP POLICY IF EXISTS "Admin HR can view bulk files" ON storage.objects;
DROP POLICY IF EXISTS "Admin HR can delete bulk files" ON storage.objects;

CREATE POLICY "Admin HR can upload bulk files"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'hrms-bulk-uploads'
  AND public.is_admin_or_hr(auth.uid())
);

CREATE POLICY "Admin HR can view bulk files"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'hrms-bulk-uploads'
  AND public.is_admin_or_hr(auth.uid())
);

CREATE POLICY "Admin HR can delete bulk files"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'hrms-bulk-uploads'
  AND public.is_admin_or_hr(auth.uid())
);

-- =====================================================
-- Process master table required by backend /api/processes
-- =====================================================
CREATE TABLE IF NOT EXISTS public.process_master (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  process_code TEXT NOT NULL UNIQUE,
  process_name TEXT NOT NULL,
  department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL,
  process_type TEXT,
  branch_name TEXT,
  location_name TEXT,
  process_owner_employee_id UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  process_manager_employee_id UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  active_status BOOLEAN NOT NULL DEFAULT true,
  description TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.process_master ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin HR can manage process master" ON public.process_master;
DROP POLICY IF EXISTS "Authenticated can view process master" ON public.process_master;

CREATE POLICY "Authenticated can view process master"
ON public.process_master
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Admin HR can manage process master"
ON public.process_master
FOR ALL
TO authenticated
USING (public.is_admin_or_hr(auth.uid()))
WITH CHECK (public.is_admin_or_hr(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_process_master_active ON public.process_master(active_status);
CREATE INDEX IF NOT EXISTS idx_process_master_department ON public.process_master(department_id);
CREATE INDEX IF NOT EXISTS idx_process_master_search ON public.process_master(process_name, process_code);

DROP TRIGGER IF EXISTS update_process_master_updated_at ON public.process_master;
CREATE TRIGGER update_process_master_updated_at
BEFORE UPDATE ON public.process_master
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================
-- Bulk upload tables
-- =====================================================
CREATE TABLE IF NOT EXISTS public.upload_template_master (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_type_code TEXT NOT NULL UNIQUE,
  upload_type_name TEXT NOT NULL,
  target_table TEXT,
  description TEXT,
  required_columns TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  optional_columns TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  sample_row JSONB NOT NULL DEFAULT '{}'::jsonb,
  validation_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  active_status BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.upload_batch (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_batch_no TEXT NOT NULL UNIQUE,
  upload_type_code TEXT NOT NULL REFERENCES public.upload_template_master(upload_type_code),
  original_file_name TEXT NOT NULL,
  file_path TEXT,
  file_size_bytes BIGINT,
  total_rows INTEGER NOT NULL DEFAULT 0,
  valid_rows INTEGER NOT NULL DEFAULT 0,
  error_rows INTEGER NOT NULL DEFAULT 0,
  imported_rows INTEGER NOT NULL DEFAULT 0,
  batch_status TEXT NOT NULL DEFAULT 'uploaded' CHECK (batch_status IN ('uploaded','validating','validated','validation_failed','importing','imported','imported_with_errors','failed','cancelled')),
  uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  validated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  imported_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  uploaded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  validated_at TIMESTAMP WITH TIME ZONE,
  imported_at TIMESTAMP WITH TIME ZONE,
  error_summary TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.upload_batch_row (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_batch_id UUID NOT NULL REFERENCES public.upload_batch(id) ON DELETE CASCADE,
  row_no INTEGER NOT NULL,
  raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  normalized_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  row_status TEXT NOT NULL DEFAULT 'pending' CHECK (row_status IN ('pending','valid','error','imported','skipped')),
  error_messages TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  target_record_id UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(upload_batch_id, row_no)
);

ALTER TABLE public.upload_template_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upload_batch ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upload_batch_row ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin HR can manage upload templates" ON public.upload_template_master;
DROP POLICY IF EXISTS "Admin HR can manage upload batches" ON public.upload_batch;
DROP POLICY IF EXISTS "Admin HR can manage upload batch rows" ON public.upload_batch_row;

CREATE POLICY "Admin HR can manage upload templates"
ON public.upload_template_master
FOR ALL
TO authenticated
USING (public.is_admin_or_hr(auth.uid()))
WITH CHECK (public.is_admin_or_hr(auth.uid()));

CREATE POLICY "Admin HR can manage upload batches"
ON public.upload_batch
FOR ALL
TO authenticated
USING (public.is_admin_or_hr(auth.uid()))
WITH CHECK (public.is_admin_or_hr(auth.uid()));

CREATE POLICY "Admin HR can manage upload batch rows"
ON public.upload_batch_row
FOR ALL
TO authenticated
USING (public.is_admin_or_hr(auth.uid()))
WITH CHECK (public.is_admin_or_hr(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_upload_batch_type ON public.upload_batch(upload_type_code);
CREATE INDEX IF NOT EXISTS idx_upload_batch_status ON public.upload_batch(batch_status);
CREATE INDEX IF NOT EXISTS idx_upload_batch_created_at ON public.upload_batch(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_upload_batch_row_batch ON public.upload_batch_row(upload_batch_id, row_no);
CREATE INDEX IF NOT EXISTS idx_upload_batch_row_status ON public.upload_batch_row(row_status);

DROP TRIGGER IF EXISTS update_upload_template_master_updated_at ON public.upload_template_master;
CREATE TRIGGER update_upload_template_master_updated_at
BEFORE UPDATE ON public.upload_template_master
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_upload_batch_updated_at ON public.upload_batch;
CREATE TRIGGER update_upload_batch_updated_at
BEFORE UPDATE ON public.upload_batch
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_upload_batch_row_updated_at ON public.upload_batch_row;
CREATE TRIGGER update_upload_batch_row_updated_at
BEFORE UPDATE ON public.upload_batch_row
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================
-- Default templates
-- =====================================================
INSERT INTO public.upload_template_master (
  upload_type_code,
  upload_type_name,
  target_table,
  description,
  required_columns,
  optional_columns,
  sample_row,
  validation_rules,
  active_status
)
VALUES
(
  'EMPLOYEE_MASTER',
  'Employee Master Upload',
  'employees',
  'Bulk create employee master records. Department and Manager are matched from existing HRMS masters. User login invite can be handled separately after import.',
  ARRAY['EmployeeCode','FirstName','LastName','Email','Designation','HireDate'],
  ARRAY['Phone','Department','ManagerCode','ManagerEmail','DateOfBirth','Gender','Address','City','Country','EmploymentType','Status','WorkingHoursStart','WorkingHoursEnd','WorkingDays'],
  '{"EmployeeCode":"MCN001","FirstName":"Amit","LastName":"Kumar","Email":"amit.kumar@example.com","Designation":"Executive","HireDate":"2026-05-16","Phone":"9876543210","Department":"Operations","ManagerCode":"MCN010","EmploymentType":"full-time","Status":"active","WorkingHoursStart":"09:00","WorkingHoursEnd":"18:00","WorkingDays":"1,2,3,4,5"}'::jsonb,
  '{"email":"must be unique","employee_code":"must be unique","date_format":"YYYY-MM-DD","status_values":["active","inactive","onboarding","offboarded"]}'::jsonb,
  true
),
(
  'DEPARTMENT_MASTER',
  'Department Master Upload',
  'departments',
  'Template prepared for future department bulk import. Current frontend stages and tracks this upload type; employee import is production-enabled first.',
  ARRAY['DepartmentName'],
  ARRAY['Description','ManagerCode'],
  '{"DepartmentName":"Operations","Description":"Operations department","ManagerCode":"MCN010"}'::jsonb,
  '{}'::jsonb,
  true
),
(
  'ASSET_MASTER',
  'Asset Master Upload',
  'assets',
  'Template prepared for future asset bulk import. Current frontend stages and tracks this upload type; employee import is production-enabled first.',
  ARRAY['AssetCode','Name','Category'],
  ARRAY['SerialNumber','Vendor','PurchaseDate','PurchaseCost','WarrantyEndDate','Status','Notes'],
  '{"AssetCode":"LAP001","Name":"Dell Laptop","Category":"Laptop","SerialNumber":"ABC123","Status":"available"}'::jsonb,
  '{}'::jsonb,
  true
)
ON CONFLICT (upload_type_code) DO UPDATE SET
  upload_type_name = EXCLUDED.upload_type_name,
  target_table = EXCLUDED.target_table,
  description = EXCLUDED.description,
  required_columns = EXCLUDED.required_columns,
  optional_columns = EXCLUDED.optional_columns,
  sample_row = EXCLUDED.sample_row,
  validation_rules = EXCLUDED.validation_rules,
  active_status = EXCLUDED.active_status,
  updated_at = now();

-- =====================================================
-- Batch number generator used by BulkUploadHub.tsx
-- =====================================================
CREATE OR REPLACE FUNCTION public.generate_upload_batch_no()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  today_key TEXT := to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYYMMDD');
  next_no INTEGER;
BEGIN
  IF NOT public.is_admin_or_hr(auth.uid()) THEN
    RAISE EXCEPTION 'Only Admin/HR can create upload batches';
  END IF;

  SELECT COALESCE(MAX((regexp_match(upload_batch_no, '^BULK-' || today_key || '-([0-9]+)$'))[1]::INTEGER), 0) + 1
  INTO next_no
  FROM public.upload_batch
  WHERE upload_batch_no LIKE 'BULK-' || today_key || '-%';

  RETURN 'BULK-' || today_key || '-' || lpad(next_no::TEXT, 4, '0');
END;
$$;

-- =====================================================
-- Generic import function. EMPLOYEE_MASTER is production-enabled now.
-- Other templates remain safely staged until their target import mapping is added.
-- =====================================================
CREATE OR REPLACE FUNCTION public.import_upload_batch(p_batch_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch public.upload_batch%ROWTYPE;
  v_row public.upload_batch_row%ROWTYPE;
  v_data JSONB;
  v_errors TEXT[];
  v_employee_id UUID;
  v_department_id UUID;
  v_manager_id UUID;
  v_employee_code TEXT;
  v_first_name TEXT;
  v_last_name TEXT;
  v_email TEXT;
  v_designation TEXT;
  v_hire_date DATE;
  v_status TEXT;
  v_work_start TIME;
  v_work_end TIME;
  v_work_days INT[];
  v_date_of_birth DATE;
  v_imported INTEGER := 0;
  v_error_rows INTEGER := 0;
  v_total_valid INTEGER := 0;
  v_part TEXT;
  v_text TEXT;
BEGIN
  IF NOT public.is_admin_or_hr(auth.uid()) THEN
    RAISE EXCEPTION 'Only Admin/HR can import upload batches';
  END IF;

  SELECT * INTO v_batch
  FROM public.upload_batch
  WHERE id = p_batch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Upload batch not found';
  END IF;

  UPDATE public.upload_batch
  SET batch_status = 'importing', imported_by = auth.uid(), updated_at = now()
  WHERE id = p_batch_id;

  IF v_batch.upload_type_code <> 'EMPLOYEE_MASTER' THEN
    UPDATE public.upload_batch
    SET batch_status = 'failed', error_summary = 'Import mapping is not configured for ' || v_batch.upload_type_code, updated_at = now()
    WHERE id = p_batch_id;

    RETURN jsonb_build_object('ok', false, 'message', 'Import mapping is not configured for ' || v_batch.upload_type_code, 'importedRows', 0);
  END IF;

  FOR v_row IN
    SELECT *
    FROM public.upload_batch_row
    WHERE upload_batch_id = p_batch_id
      AND row_status = 'valid'
    ORDER BY row_no
  LOOP
    v_total_valid := v_total_valid + 1;
    v_data := COALESCE(v_row.normalized_data, v_row.raw_data, '{}'::jsonb);
    v_errors := ARRAY[]::TEXT[];
    v_department_id := NULL;
    v_manager_id := NULL;
    v_employee_id := NULL;
    v_work_days := NULL;
    v_date_of_birth := NULL;

    v_employee_code := upper(trim(COALESCE(v_data->>'EmployeeCode', v_data->>'employee_code', v_data->>'Employee Code', '')));
    v_first_name := trim(COALESCE(v_data->>'FirstName', v_data->>'first_name', v_data->>'First Name', ''));
    v_last_name := trim(COALESCE(v_data->>'LastName', v_data->>'last_name', v_data->>'Last Name', ''));
    v_email := lower(trim(COALESCE(v_data->>'Email', v_data->>'email', '')));
    v_designation := trim(COALESCE(v_data->>'Designation', v_data->>'designation', ''));

    IF v_employee_code = '' THEN v_errors := array_append(v_errors, 'EmployeeCode is required'); END IF;
    IF v_first_name = '' THEN v_errors := array_append(v_errors, 'FirstName is required'); END IF;
    IF v_last_name = '' THEN v_errors := array_append(v_errors, 'LastName is required'); END IF;
    IF v_email = '' THEN v_errors := array_append(v_errors, 'Email is required'); END IF;
    IF v_email <> '' AND v_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' THEN v_errors := array_append(v_errors, 'Email format is invalid'); END IF;
    IF v_designation = '' THEN v_errors := array_append(v_errors, 'Designation is required'); END IF;

    BEGIN
      v_text := trim(COALESCE(v_data->>'HireDate', v_data->>'hire_date', v_data->>'Hire Date', ''));
      IF v_text = '' THEN
        v_errors := array_append(v_errors, 'HireDate is required');
      ELSE
        v_hire_date := v_text::DATE;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_errors := array_append(v_errors, 'HireDate must be YYYY-MM-DD');
    END;

    v_status := lower(trim(COALESCE(v_data->>'Status', v_data->>'status', 'active')));
    IF v_status = '' THEN v_status := 'active'; END IF;
    IF v_status NOT IN ('active','inactive','onboarding','offboarded') THEN
      v_errors := array_append(v_errors, 'Status must be active, inactive, onboarding, or offboarded');
    END IF;

    BEGIN
      v_text := trim(COALESCE(v_data->>'DateOfBirth', v_data->>'date_of_birth', v_data->>'DOB', ''));
      IF v_text <> '' THEN
        v_date_of_birth := v_text::DATE;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_errors := array_append(v_errors, 'DateOfBirth must be YYYY-MM-DD');
    END;

    IF v_employee_code <> '' AND EXISTS (SELECT 1 FROM public.employees WHERE employee_code = v_employee_code) THEN
      v_errors := array_append(v_errors, 'EmployeeCode already exists: ' || v_employee_code);
    END IF;

    IF v_email <> '' AND EXISTS (SELECT 1 FROM public.employees WHERE lower(email) = v_email) THEN
      v_errors := array_append(v_errors, 'Email already exists: ' || v_email);
    END IF;

    v_text := trim(COALESCE(v_data->>'Department', v_data->>'department', v_data->>'DepartmentName', ''));
    IF v_text <> '' THEN
      SELECT id INTO v_department_id
      FROM public.departments
      WHERE lower(name) = lower(v_text)
      LIMIT 1;
      IF v_department_id IS NULL THEN
        v_errors := array_append(v_errors, 'Department not found: ' || v_text);
      END IF;
    END IF;

    v_text := trim(COALESCE(v_data->>'ManagerCode', v_data->>'manager_code', v_data->>'Manager Employee Code', ''));
    IF v_text <> '' THEN
      SELECT id INTO v_manager_id
      FROM public.employees
      WHERE lower(employee_code) = lower(v_text)
      LIMIT 1;
      IF v_manager_id IS NULL THEN
        v_errors := array_append(v_errors, 'ManagerCode not found: ' || v_text);
      END IF;
    END IF;

    v_text := lower(trim(COALESCE(v_data->>'ManagerEmail', v_data->>'manager_email', '')));
    IF v_manager_id IS NULL AND v_text <> '' THEN
      SELECT id INTO v_manager_id
      FROM public.employees
      WHERE lower(email) = v_text
      LIMIT 1;
      IF v_manager_id IS NULL THEN
        v_errors := array_append(v_errors, 'ManagerEmail not found: ' || v_text);
      END IF;
    END IF;

    BEGIN
      v_text := trim(COALESCE(v_data->>'WorkingHoursStart', v_data->>'working_hours_start', '09:00'));
      IF v_text = '' THEN v_text := '09:00'; END IF;
      v_work_start := v_text::TIME;
    EXCEPTION WHEN OTHERS THEN
      v_errors := array_append(v_errors, 'WorkingHoursStart must be HH:MM');
    END;

    BEGIN
      v_text := trim(COALESCE(v_data->>'WorkingHoursEnd', v_data->>'working_hours_end', '18:00'));
      IF v_text = '' THEN v_text := '18:00'; END IF;
      v_work_end := v_text::TIME;
    EXCEPTION WHEN OTHERS THEN
      v_errors := array_append(v_errors, 'WorkingHoursEnd must be HH:MM');
    END;

    v_text := trim(COALESCE(v_data->>'WorkingDays', v_data->>'working_days', '1,2,3,4,5'));
    IF v_text <> '' THEN
      v_work_days := ARRAY[]::INT[];
      FOREACH v_part IN ARRAY string_to_array(replace(v_text, ' ', ''), ',') LOOP
        BEGIN
          IF v_part <> '' THEN
            IF v_part::INT < 0 OR v_part::INT > 6 THEN
              v_errors := array_append(v_errors, 'WorkingDays values must be 0-6');
            ELSE
              v_work_days := array_append(v_work_days, v_part::INT);
            END IF;
          END IF;
        EXCEPTION WHEN OTHERS THEN
          v_errors := array_append(v_errors, 'WorkingDays must be comma-separated numbers 0-6');
        END;
      END LOOP;
    END IF;

    IF array_length(v_errors, 1) IS NOT NULL THEN
      UPDATE public.upload_batch_row
      SET row_status = 'error', error_messages = v_errors, updated_at = now()
      WHERE id = v_row.id;
      v_error_rows := v_error_rows + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.employees (
      employee_code,
      first_name,
      last_name,
      email,
      phone,
      date_of_birth,
      gender,
      address,
      city,
      country,
      department_id,
      designation,
      manager_id,
      hire_date,
      employment_type,
      status,
      working_hours_start,
      working_hours_end,
      working_days
    )
    VALUES (
      v_employee_code,
      v_first_name,
      v_last_name,
      v_email,
      NULLIF(trim(COALESCE(v_data->>'Phone', v_data->>'phone', '')), ''),
      v_date_of_birth,
      NULLIF(trim(COALESCE(v_data->>'Gender', v_data->>'gender', '')), ''),
      NULLIF(trim(COALESCE(v_data->>'Address', v_data->>'address', '')), ''),
      NULLIF(trim(COALESCE(v_data->>'City', v_data->>'city', '')), ''),
      NULLIF(trim(COALESCE(v_data->>'Country', v_data->>'country', '')), ''),
      v_department_id,
      v_designation,
      v_manager_id,
      v_hire_date,
      NULLIF(trim(COALESCE(v_data->>'EmploymentType', v_data->>'employment_type', 'full-time')), ''),
      v_status::public.employee_status,
      v_work_start,
      v_work_end,
      COALESCE(v_work_days, ARRAY[1,2,3,4,5]::INT[])
    )
    RETURNING id INTO v_employee_id;

    UPDATE public.upload_batch_row
    SET row_status = 'imported', target_record_id = v_employee_id, error_messages = ARRAY[]::TEXT[], updated_at = now()
    WHERE id = v_row.id;

    v_imported := v_imported + 1;
  END LOOP;

  UPDATE public.upload_batch
  SET imported_rows = v_imported,
      error_rows = (SELECT COUNT(*) FROM public.upload_batch_row WHERE upload_batch_id = p_batch_id AND row_status = 'error'),
      valid_rows = (SELECT COUNT(*) FROM public.upload_batch_row WHERE upload_batch_id = p_batch_id AND row_status IN ('valid','imported')),
      batch_status = CASE
        WHEN v_imported > 0 AND (SELECT COUNT(*) FROM public.upload_batch_row WHERE upload_batch_id = p_batch_id AND row_status = 'error') > 0 THEN 'imported_with_errors'
        WHEN v_imported > 0 THEN 'imported'
        ELSE 'failed'
      END,
      imported_by = auth.uid(),
      imported_at = now(),
      error_summary = CASE
        WHEN (SELECT COUNT(*) FROM public.upload_batch_row WHERE upload_batch_id = p_batch_id AND row_status = 'error') > 0
          THEN (SELECT COUNT(*) FROM public.upload_batch_row WHERE upload_batch_id = p_batch_id AND row_status = 'error')::TEXT || ' row(s) failed during import'
        ELSE NULL
      END,
      updated_at = now()
  WHERE id = p_batch_id;

  INSERT INTO public.activity_logs(user_id, action, entity_type, entity_id, details)
  VALUES (
    auth.uid(),
    'BULK_UPLOAD_IMPORTED',
    'upload_batch',
    p_batch_id,
    jsonb_build_object('upload_type_code', v_batch.upload_type_code, 'imported_rows', v_imported, 'error_rows', v_error_rows)
  );

  RETURN jsonb_build_object('ok', true, 'message', 'Import completed', 'importedRows', v_imported, 'errorRows', v_error_rows, 'validRowsProcessed', v_total_valid);
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_upload_batch_no() TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_upload_batch(UUID) TO authenticated;
