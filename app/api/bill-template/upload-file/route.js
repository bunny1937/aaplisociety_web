import { NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
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
    const type = formData.get('type');
    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }
    // Validate file type
    const validTypes = {
      pdf: ['application/pdf'],
      image: ['image/jpeg', 'image/jpg', 'image/png'],
      logo: ['image/jpeg', 'image/jpg', 'image/png'],
      signature: ['image/jpeg', 'image/jpg', 'image/png']
    };
    if (!validTypes[type]?.includes(file.type)) {
      return NextResponse.json({ error: 'Invalid file type' }, { status: 400 });
    }
    // Size limit: 5MB for PDF, 2MB for images
    const maxSize = type === 'pdf' ? 5 * 1024 * 1024 : 2 * 1024 * 1024;
    if (file.size > maxSize) {
      return NextResponse.json({ 
        error: `File too large. Max ${maxSize / 1024 / 1024}MB` 
      }, { status: 400 });
    }
    // Convert to buffer
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    // Magic-byte validation (guard against MIME spoofing)
    const isPdf = buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
    const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
    const magicOk = (type === 'pdf' && isPdf) || (['image', 'logo', 'signature'].includes(type) && (isJpeg || isPng));
    if (!magicOk) {
      return NextResponse.json({ error: 'File content does not match declared type' }, { status: 400 });
    }
    // Create directory
    const uploadsDir = join(process.cwd(), 'public', 'uploads', 'bills');
    if (!existsSync(uploadsDir)) {
      await mkdir(uploadsDir, { recursive: true });
    }
    // Generate filename
    const ext = file.name.split('.').pop();
    const filename = `${decoded.societyId}-${type}-${Date.now()}.${ext}`;
    const filePath = join(uploadsDir, filename);
    // Save file
    await writeFile(filePath, buffer);
    const publicUrl = `/uploads/bills/${filename}`;
    console.log(`✅ Uploaded ${type}:`, publicUrl);
    return NextResponse.json({
      success: true,
      url: publicUrl,
      type,
      filename
    });
  } catch (error) {
    console.error('❌ Upload file error:', error);
    return NextResponse.json({
      error: 'Upload failed',
      details: error.message
    }, { status: 500 });
  }
}
