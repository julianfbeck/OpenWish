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

    static func listBugs() async -> ApiResult<BugListResponse, ApiError> {
        guard let url = listEndpoint else {
            return .failure(ApiError(reason: .couldNotCreateRequest))
        }
        let urlRequest = createAuthedGETReuqest(to: url)
        return await Api.send(request: urlRequest)
    }

    static func createBug(request: CreateBugRequest) async -> ApiResult<CreateBugResponse, ApiError> {
        guard let url = createBugEndpoint else {
            return .failure(ApiError(reason: .couldNotCreateRequest))
        }
        let urlRequest = createAuthedPOSTReuqest(to: url, with: request)
        return await Api.send(request: urlRequest)
    }

    static func uploadScreenshot(
        data: Data,
        contentType: String,
    ) async -> ApiResult<BugScreenshotUploadResponse, ApiError> {
        guard let url = screenshotEndpoint else {
            return .failure(ApiError(reason: .couldNotCreateRequest))
        }
        let urlRequest = createAuthedRawPOSTRequest(to: url, body: data, contentType: contentType)
        return await Api.send(request: urlRequest)
    }
}
