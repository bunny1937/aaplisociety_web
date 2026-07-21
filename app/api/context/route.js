import { NextResponse } from "next/server";
import connectDB  from "@/lib/mongodb";
import Context from "@/models/Context";
export async function GET(req) {
  await connectDB();
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json(
      { error: "projectId required" },
      { status: 400 }
    );
  }
  const context = await Context.findOne({ projectId });
  if (!context) {
    return NextResponse.json(
      { error: "No context found" },
      { status: 404 }
    );
  }
  const formattedContext = `
### PROJECT CONTEXT ###
- Project: ${context.project}
- Stack: ${context.stack}
### CURRENT ISSUE ###
${context.currentIssue}
### NOTES ###
${context.notes}
### INSTRUCTION ###
You are an expert developer. Solve the issue without breaking existing functionality.
`;
  return NextResponse.json({
    prompt: formattedContext,
  });
}
export async function POST(req) {
  await connectDB();
  let body = {};
  try {
    body = await req.json();
  } catch (err) {
    return NextResponse.json(
      { error: "Invalid or empty JSON body" },
      { status: 400 }
    );
  }
  const { projectId, project, stack, currentIssue, notes } = body;
  if (!projectId) {
    return NextResponse.json(
      { error: "projectId required" },
      { status: 400 }
    );
  }
  const updateData = {
    updatedAt: new Date(),
  };
  if (project !== undefined) updateData.project = project;
  if (stack !== undefined) updateData.stack = stack;
  if (currentIssue !== undefined) updateData.currentIssue = currentIssue;
  if (notes !== undefined) updateData.notes = notes;
  const updated = await Context.findOneAndUpdate(
    { projectId },
    { $set: updateData },
    { upsert: true, new: true }
  );
  return NextResponse.json({
    message: "Context updated",
    data: updated,
  });
}
