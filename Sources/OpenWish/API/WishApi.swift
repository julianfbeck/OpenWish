//
//  WishApi.swift
//  wishkit-ios
//
//  Created by Martin Lasek on 2/10/23.
//  Copyright © 2023 Martin Lasek. All rights reserved.
//

import Foundation
import WishKitShared

struct WishApi: RequestCreatable {

    private static var legacyEndpoint: URL? { URL(string: "\(ProjectSettings.apiUrl)/wish") }
    private static var v2Endpoint: URL? { URL(string: "\(ProjectSettings.apiUrl)/v2/features") }

    // MARK: - URLRequests

    private static func fetchWishList() -> URLRequest? {
        guard var url = legacyEndpoint else { return nil }
        url.appendPathComponent("list")
        return createAuthedGETReuqest(to: url)
    }

    private static func fetchV2WishList() -> URLRequest? {
        guard let url = v2Endpoint else { return nil }
        return createAuthedGETReuqest(to: url)
    }

    private static func createWish(_ createRequest: CreateWishRequest) -> URLRequest? {
        guard var url = legacyEndpoint else { return nil }
        url.appendPathComponent("create")
        return createAuthedPOSTReuqest(to: url, with: createRequest)
    }

    private static func voteWish(_ voteRequest: VoteWishRequest) -> URLRequest? {
        guard var url = legacyEndpoint else { return nil }
        url.appendPathComponent("vote")
        return createAuthedPOSTReuqest(to: url, with: voteRequest)
    }

    // MARK: - Api Requests

    static func fetchWishList(
        completionHandler: @escaping (ApiResult<ListWishResponse, ApiError>) -> Void
    ) {
        let useV2 = ProjectSettings.shouldTryV2
        guard let request = useV2 ? fetchV2WishList() : fetchWishList() else {
            completionHandler(.failure(ApiError(reason: .couldNotCreateRequest)))
            return
        }

        Api.send(request: request) { (result: ApiResult<ListWishResponse, ApiError>) in
            if case .failure = result, useV2, OpenWish.apiVersion == .automatic,
               let fallback = fetchWishList() {
                Api.send(request: fallback, completionHandler: completionHandler)
            } else {
                completionHandler(result)
            }
        }
    }

    static func createWish(
        createRequest: CreateWishRequest,
        completionHandler: @escaping (ApiResult<CreateWishResponse, ApiError>) -> Void
    ) {

        guard let request = createWish(createRequest) else {
            completionHandler(.failure(ApiError(reason: .couldNotCreateRequest)))
            return
        }

        Api.send(request: request, completionHandler: completionHandler)
    }

    static func voteWish(
        voteRequest: VoteWishRequest,
        completionHandler: @escaping (ApiResult<VoteWishResponse, ApiError>) -> Void
    ) {

        guard let request = voteWish(voteRequest) else {
            completionHandler(.failure(ApiError(reason: .couldNotCreateRequest)))
            return
        }

        Api.send(request: request, completionHandler: completionHandler)
    }
}
