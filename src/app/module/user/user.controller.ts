import { Request, Response } from "express";
import httpstatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { UserService } from "./user.service";

const uploadProfileImage = catchAsync(async (req: Request, res: Response) => {
	if (!req.file) {
		throw new Error("No File Uploaded.");
	}
	const userId = req.user?.userId;
	const updatedUser = await UserService.uploadProfileImage(
		req.file?.buffer,
		userId as string,
	);
	sendResponse(res, {
		statusCode: httpstatus.OK,
		success: true,
		message: "Profile Picture Uploaded Successfully.",
		data: updatedUser,
	});
});

export const UserController = {
	uploadProfileImage,
};
