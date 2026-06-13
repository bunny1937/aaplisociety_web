import { NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { PDFDocument } from 'pdf-lib';
import connectDB from '@/lib/mongodb';
import { requireRoles, SOCIETY_ADMIN_ROLES } from '@/lib/authz';

export async function POST(request) {
  try {
    await connectDB();
    
    const auth = requireRoles(request, SOCIETY_ADMIN_ROLES);
    if (!auth.valid) return auth;
    const decoded = auth.user;

    const formData = await request.formData();
    const file = formData.get('file');

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    if (file.type !== 'application/pdf') {
      return NextResponse.json({ error: 'Only PDF files allowed' }, { status: 400 });
    }

    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ 
        error: 'File too large. Max 5MB' 
      }, { status: 400 });
    }

    // Convert to buffer
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Magic-byte validation — PDF must start with %PDF
    const isPdf = buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
    if (!isPdf) {
      return NextResponse.json({ error: 'File is not a valid PDF' }, { status: 400 });
    }

    // Load PDF and detect form fields
    const pdfDoc = await PDFDocument.load(buffer);
    const form = pdfDoc.getForm();
    const fields = form.getFields();

    const hasFormFields = fields.length > 0;
    const detectedFields = fields.map(field => field.getName());

    console.log(`✅ PDF Analysis: ${hasFormFields ? `${fields.length} form fields detected` : 'No form fields - will overlay'}`);

    // Save PDF
    const uploadsDir = join(process.cwd(), 'public', 'uploads', 'bills');
    if (!existsSync(uploadsDir)) {
      await mkdir(uploadsDir, { recursive: true });
    }

    const filename = `${decoded.societyId}-pdf-${Date.now()}.pdf`;
    const filePath = join(uploadsDir, filename);

    await writeFile(filePath, buffer);

    const publicUrl = `/uploads/bills/${filename}`;

    return NextResponse.json({
      success: true,
      url: publicUrl,
      filename,
      hasFormFields,
      detectedFields,
      message: hasFormFields 
        ? `Auto-detected ${fields.length} fillable fields` 
        : 'Will overlay data on PDF'
    });

  } catch (error) {
    console.error('❌ Upload PDF error:', error);
    return NextResponse.json({
      error: 'Upload failed',
      details: error.message
    }, { status: 500 });
  }
}
