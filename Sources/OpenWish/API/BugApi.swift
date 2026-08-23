//
//  BugApi.swift
//  OpenWish
//
//  OpenWish-specific bug-report endpoints.
//

import Foundation
import WishKitShared

struct BugApi: RequestCreatable {

    private static var baseUrl: String { ProjectSettings.apiUrl }

    private static var createBugEndpoint: URL? {
        URL(string: "\(baseUrl)/bug/create")
    }

    private static var screenshotEndpoint: URL? {
        URL(string: "\(baseUrl)/bug/screenshot")
    }

    private static var listEndpoint: URL? {
        URL(string: "\(baseUrl)/bug/list")
    }

    private static var v2IssuesEndpoint: URL? { URL(string: "\(baseUrl)/v2/issues") }
    private static var v2AttachmentsEndpoint: URL? { URL(string: "\(baseUrl)/v2/attachments") }

    static func listBugs() async -> ApiResult<BugListResponse, ApiError> {
        let wantsV2 = ProjectSettings.shouldTryV2
        guard let url = wantsV2 ? v2IssuesEndpoint : listEndpoint else {
            return .failure(ApiError(reason: .couldNotCreateRequest))
        }
        let urlRequest = createAuthedGETReuqest(to: url)
        let result: ApiResult<BugListResponse, ApiError> = await Api.send(request: urlRequest)
        if case .failure = result, wantsV2, OpenWish.apiVersion == .automatic,
           let fallbackUrl = listEndpoint {
            return await Api.send(request: createAuthedGETReuqest(to: fallbackUrl))
        }
        return result
    }

    static func createBug(request: CreateBugRequest) async -> ApiResult<CreateBugResponse, ApiError> {
        let wantsV2 = ProjectSettings.shouldTryV2
        guard let url = wantsV2 ? v2IssuesEndpoint : createBugEndpoint else {
            return .failure(ApiError(reason: .couldNotCreateRequest))
        }
        let urlRequest = createAuthedPOSTReuqest(to: url, with: request)
        let result: ApiResult<CreateBugResponse, ApiError> = await Api.send(request: urlRequest)
        if case .failure = result, wantsV2, OpenWish.apiVersion == .automatic,
           let fallbackUrl = createBugEndpoint {
            return await Api.send(request: createAuthedPOSTReuqest(to: fallbackUrl, with: request))
        }
        return result
    }

    static func uploadScreenshot(
        data: Data,
        contentType: String,
    ) async -> ApiResult<BugScreenshotUploadResponse, ApiError> {
        let wantsV2 = ProjectSettings.shouldTryV2
        guard let url = wantsV2 ? v2AttachmentsEndpoint : screenshotEndpoint else {
            return .failure(ApiError(reason: .couldNotCreateRequest))
        }
        let urlRequest = createAuthedRawPOSTRequest(to: url, body: data, contentType: contentType)
        let result: ApiResult<BugScreenshotUploadResponse, ApiError> = await Api.send(request: urlRequest)
        if case .failure = result, wantsV2, OpenWish.apiVersion == .automatic,
           let fallbackUrl = screenshotEndpoint {
            return await Api.send(
                request: createAuthedRawPOSTRequest(to: fallbackUrl, body: data, contentType: contentType)
            )
        }
        return result
    }
}
